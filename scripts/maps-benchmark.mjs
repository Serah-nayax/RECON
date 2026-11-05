#!/usr/bin/env node
// Maps search benchmark: is a change faster without losing places?
//
//   node scripts/maps-benchmark.mjs "arcade" "Paris"            run a new search, then compare
//   node scripts/maps-benchmark.mjs "arcade" "Paris" --job <id>  compare a finished search only
//
// Reference = every place found by earlier finished searches with the same term and area
// (Google's lists vary from one run to the next, so their union is the best known truth).
// Reports: time, places, share of the reference found (all places and on-topic places), the
// on-topic places missed, and where the time went (per term / depth, per phase).
// Needs Recon running locally (start-recon.cmd).

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const base = flag("--url") ?? "http://localhost:8080";
const existingJob = flag("--job");
const osmId = flag("--osm");
const onTopicRx = new RegExp(
  flag("--topic") ??
    "arcade|amusement|game|jeux|laser|bowling|escape|pinball|billiard|pool hall|entertainment|virtual reality|kart|play|bowl",
  "i",
);
const [term, area] = args;
if (!term || !area) {
  console.error('Usage: node scripts/maps-benchmark.mjs "<term>" "<area>" [--job <id>] [--osm R7444] [--topic <regex>]');
  process.exit(1);
}

const api = async (path, init) => {
  const res = await fetch(base + "/api" + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};
const norm = (s) => String(s ?? "").toLowerCase().trim();
const placeId = (r) => (r.mapsUrl ?? "").match(/!1s([^!?&]+)/)?.[1] ?? norm(r.name);
const minutes = (ms) => (ms / 60000).toFixed(1) + " min";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSearch() {
  const started = await api("/maps/search", {
    method: "POST",
    body: JSON.stringify({ searchTerms: [term], areas: [osmId ? { label: area, osmId } : area] }),
  });
  console.log(`Search started: ${started.jobId} (${started.totalCells} cells)`);
  for (;;) {
    await sleep(15000);
    const job = await api(`/maps/${started.jobId}`);
    process.stdout.write(`\r  ${job.status} ${job.completedCells}/${job.totalCells} cells, ${job.totalLeads} places   `);
    if (["done", "failed", "paused"].includes(job.status)) {
      console.log();
      return started.jobId;
    }
  }
}

const jobId = existingJob ?? (await runSearch());
const job = await api(`/maps/${jobId}`);
const list = await api("/maps");
const all = Array.isArray(list) ? list : list.jobs;
const earlier = all.filter(
  (j) => j.jobId !== jobId && j.status === "done" && norm(j.config?.searchTerm) === norm(term) &&
    (norm(j.config?.location) === norm(area) || norm(j.config?.location).startsWith(norm(area) + ",")),
);
const earlierJobs = await Promise.all(earlier.map((j) => api(`/maps/${j.jobId}`)));

// Only reference places inside this search's cells (older searches may have covered more).
const cells = job.cells.filter((c) => c.status !== "skipped");
const inCells = (r) =>
  r.lat == null || r.lng == null ||
  cells.some((c) => c.halfDeg && Math.abs(r.lat - c.lat) <= c.halfDeg && Math.abs(r.lng - c.lng) <= c.halfDeg);
const reference = new Map();
for (const j of earlierJobs) for (const r of j.results) if (r.lat != null && inCells(r)) reference.set(placeId(r), r);
const found = new Set(job.results.map(placeId));
const onTopic = (r) => onTopicRx.test(r.category ?? "");

const wall = new Date(job.updatedAt) - new Date(job.createdAt);
const browser = cells.reduce((s, c) => s + (c.durationMs ?? 0), 0);
console.log(`\n== ${term} in ${job.config.location}  (${jobId})`);
console.log(`Time: ${minutes(wall)} wall, ${minutes(browser)} browser time, ${cells.length} cells`);
console.log(`Places: ${job.results.length} (on-topic: ${job.results.filter(onTopic).length})`);

if (reference.size) {
  const ref = [...reference.values()];
  const refTopic = ref.filter(onTopic);
  const hit = (rs) => rs.filter((r) => found.has(placeId(r))).length;
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
  console.log(`Reference: ${earlierJobs.length} earlier searches, ${ref.length} places (${refTopic.length} on-topic)`);
  console.log(`Found: ${pct(hit(ref), ref.length)} of all, ${pct(hit(refTopic), refTopic.length)} of on-topic`);
  for (const j of earlierJobs.slice(0, 5)) {
    const ids = new Set(j.results.map(placeId));
    const t = refTopic.filter((r) => ids.has(placeId(r))).length;
    console.log(`  earlier ${j.jobId.slice(0, 8)} ${j.createdAt.slice(0, 16)}: ${pct(t, refTopic.length)} of on-topic, ${minutes(new Date(j.updatedAt) - new Date(j.createdAt))}`);
  }
  // Places whose address names the area: older searches used a box that also covered
  // suburbs, which the area's real outline now leaves out on purpose (Paris: La Défense).
  const areaWord = norm(area.split(",")[0]);
  const inArea = (r) => norm(r.address).includes(areaWord);
  const refArea = refTopic.filter(inArea);
  console.log(`Found: ${pct(hit(refArea), refArea.length)} of on-topic places whose address says "${areaWord}" (${refArea.length})`);
  for (const j of earlierJobs.slice(0, 5)) {
    const ids = new Set(j.results.map(placeId));
    console.log(`  earlier ${j.jobId.slice(0, 8)}: ${pct(refArea.filter((r) => ids.has(placeId(r))).length, refArea.length)}`);
  }
  const missed = refTopic.filter((r) => !found.has(placeId(r)));
  if (missed.length) {
    console.log(`On-topic places missed (${missed.length}, * = address in "${areaWord}"):`);
    for (const r of missed.sort((a, b) => Number(inArea(b)) - Number(inArea(a)))) {
      console.log(`  ${inArea(r) ? "*" : "-"} ${r.name} [${(r.category ?? "").split(",")[0]}]`);
    }
  }
  const newOnes = job.results.filter((r) => onTopic(r) && !reference.has(placeId(r)));
  if (newOnes.length) console.log(`On-topic places no earlier search found: ${newOnes.length}`);
} else {
  console.log("No earlier finished search with this term and area: nothing to compare with yet.");
}

// Where the time went.
const groups = new Map();
for (const c of cells) {
  const key = `${c.searchTerm ?? job.config.searchTerm}${c.autoTerm ? " (auto)" : ""} · depth ${c.depth ?? 0}`;
  const g = groups.get(key) ?? { n: 0, ms: 0, fresh: 0 };
  g.n++; g.ms += c.durationMs ?? 0; g.fresh += c.newLeads ?? 0;
  groups.set(key, g);
}
console.log("\nCells by term and depth:");
for (const [key, g] of groups) console.log(`  ${key.padEnd(44)} ${String(g.n).padStart(4)} cells  ${minutes(g.ms).padStart(9)}  ${String(g.fresh).padStart(4)} new places`);
const short = cells.filter((c) => c.rawPlaces >= 15 && c.rawPlaces <= 22);
const retried = cells.filter((c) => c.pageCutRetried);
console.log(`Cells stopped at ~1 page (15-22 places): ${short.length}; searched again after Google's first page only: ${retried.length}` +
  (retried.length ? ` (after the retry: ${retried.map((c) => c.rawPlaces).join(", ")} places)` : ""));
const phases = {};
for (const c of cells) for (const [p, ms] of Object.entries(c.phasesMs ?? {})) phases[p] = (phases[p] ?? 0) + ms;
if (Object.keys(phases).length) {
  console.log("Browser time by phase:");
  for (const [p, ms] of Object.entries(phases).sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(14)} ${minutes(ms)}`);
}
