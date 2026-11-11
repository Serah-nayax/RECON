// Builds api-server/data/places.json.gz: the countries, regions, sub-regions and towns (5,000+
// inhabitants) the area box suggests while typing, instantly and offline.
// Source: GeoNames (https://www.geonames.org), free, CC BY 4.0. Run again to refresh:
//   node scripts/build-gazetteer.mjs
//
// One entry per area people mean: neighbourhoods and historical places are left out, a
// sub-region named like its town (the Paris département) is the town, and a region that is
// one town (Berlin) is the town.

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, inflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "api-server", "data", "places.json.gz");
const BASE = "https://download.geonames.org/export/dump/";

// Downloads go to a new empty folder: they are data, never run.
const dir = mkdtempSync(path.join(tmpdir(), "recon-geonames-"));
async function download(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path.join(dir, name), buf);
  console.log(`downloaded ${name} (${(buf.length / 1e6).toFixed(1)} MB)`);
  return buf;
}

/** The first file of a zip archive (GeoNames zips hold one file). */
function unzipFirst(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cd = zip.readUInt32LE(eocd + 16);
  const method = zip.readUInt16LE(cd + 10);
  const size = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + size);
  return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
}

/** Same as coreName() in api-server/src/lib/gazetteer.ts: "State of Berlin" → "berlin". */
const coreName = (s) =>
  normalize(s)
    .replace(/^(state|province|region|department|district|county|governorate|prefecture|city|municipality) of /, "")
    .replace(/ (state|province|region|district|county|governorate|prefecture|oblast|metropolitan|d c)$/, "");

const rows = (text) => text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));

/** Same as normalize() in api-server/src/lib/gazetteer.ts. */
const normalize = (s) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const [countryText, admin1Text, admin2Text, citiesZip] = await Promise.all([
  download("countryInfo.txt").then(String),
  download("admin1CodesASCII.txt").then(String),
  download("admin2Codes.txt").then(String),
  download("cities5000.zip"),
]);
const cityRows = rows(unzipFirst(citiesZip));

// Towns: populated places, without neighbourhoods (PPLX), historical, abandoned or destroyed ones.
const SKIP_TOWN = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"]);
const towns = cityRows
  .filter((r) => r[6] === "P" && !SKIP_TOWN.has(r[7]))
  .map((r) => ({
    id: r[0], name: r[1], ascii: r[2], alts: r[3] ? r[3].split(",") : [],
    lat: +r[4], lng: +r[5], cc: r[8], a1: `${r[8]}.${r[10]}`, a2: `${r[8]}.${r[10]}.${r[11]}`, pop: +r[14] || 0,
  }));

// Regions get the population of their towns and the position of the biggest one (used to
// pick the right outline among namesakes).
const regionStats = new Map();
for (const t of [...towns].sort((a, b) => b.pop - a.pop)) {
  for (const key of [t.a1, t.a2]) {
    const s = regionStats.get(key);
    if (s) s.pop += t.pop;
    else regionStats.set(key, { pop: t.pop, lat: t.lat, lng: t.lng, top: t });
  }
}

const LATIN = /^[a-z0-9 ]+$/;
const HEBREW = /[\u0590-\u05ff]/;

/**
 * Names to match (normalized, without the main name), "saint"/"st" both ways. Other names
 * are kept in Latin script and Hebrew (the languages the team types); `few` keeps only the
 * Hebrew ones and the ASCII spelling (small towns: their other names are rarely typed).
 */
function matchNames(main, names, few = false) {
  const own = normalize(main);
  const out = new Set();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 2 || name.length > 60 || /\d/.test(name) || /^[A-Z]{2,4}$/.test(name)) continue;
    const n = normalize(name);
    if (!n || !(HEBREW.test(n) || (LATIN.test(n) && (!few || n === normalize(names[0] ?? ""))))) continue;
    out.add(n);
  }
  for (const n of [...out, own]) {
    const short = n.replace(/^saint /, "st ").replace(/^sainte /, "ste ");
    if (short !== n) out.add(short);
  }
  out.delete(own);
  return [...out].join("|");
}

// Country names in the languages the team types (Allemagne, Deutschland, גרמניה…).
const LANGS = ["en", "fr", "de", "es", "it", "pt", "nl", "he", "ar", "ru"];
const displayNames = LANGS.map((l) => new Intl.DisplayNames([l], { type: "region" }));
const COUNTRY_ALIASES = {
  US: ["USA", "United States of America", "America", "Etats-Unis", "Etats Unis"],
  GB: ["UK", "Great Britain", "Britain", "Grande-Bretagne"],
  AE: ["UAE", "EAU"],
  NL: ["Holland"],
  CZ: ["Czech Republic"],
  KR: ["Korea"],
};

const entries = []; // [id, kind, name, cc, regionKey, lat, lng, population, altNames]
const countries = {};
for (const r of rows(countryText)) {
  const [cc, , , , name] = r;
  const pop = +r[7] || 0;
  countries[cc] = name;
  const names = displayNames.map((d) => { try { return d.of(cc) ?? ""; } catch { return ""; } });
  const capital = towns.find((t) => t.cc === cc && t.name === r[5]);
  entries.push([`G${r[16]}`, 0, name, cc, "", capital?.lat ?? 0, capital?.lng ?? 0, pop, matchNames(name, [...names, ...(COUNTRY_ALIASES[cc] ?? [])])]);
}

const admin1 = {};
const townKeys = new Set(towns.map((t) => `${t.cc}|${normalize(t.name)}`));
let skippedRegions = 0;
let skippedSmall = 0;
for (const [key, name, ascii, id] of rows(admin1Text)) {
  admin1[key] = name;
  const s = regionStats.get(key);
  // A region that is one town (Berlin, Hamburg, Vienna…) is that town.
  if (s && normalize(s.top.name) === coreName(name) && s.top.pop >= 0.85 * s.pop) { skippedRegions++; continue; }
  entries.push([`G${id}`, 1, name, key.split(".")[0], "", s?.lat ?? 0, s?.lng ?? 0, s?.pop ?? 0, matchNames(name, [ascii])]);
}

for (const [key, name, ascii, id] of rows(admin2Text)) {
  const [cc, a1] = key.split(".");
  // A sub-region named exactly like a town of its country (the Paris département, Brazilian
  // municipalities) or like its region is that town or region. Los Angeles County stays.
  if (townKeys.has(`${cc}|${normalize(name)}`) || coreName(admin1[`${cc}.${a1}`] ?? "") === coreName(name)) {
    skippedRegions++;
    continue;
  }
  const s = regionStats.get(key);
  // Without any town of 5,000+ inhabitants it is too small to search as a whole (still found
  // through OpenStreetMap when typed).
  if (!s) { skippedSmall++; continue; }
  entries.push([`G${id}`, 2, name, cc, `${cc}.${a1}`, s.lat, s.lng, s.pop, matchNames(name, [ascii])]);
}

// One town per name in a region: the biggest (GeoNames sometimes has a town twice).
const seenTowns = new Set();
for (const t of [...towns].sort((a, b) => b.pop - a.pop)) {
  const key = `${t.a1}|${normalize(t.name)}`;
  if (seenTowns.has(key)) continue;
  seenTowns.add(key);
  entries.push([`G${t.id}`, 3, t.name, t.cc, t.a1, +t.lat.toFixed(4), +t.lng.toFixed(4), t.pop, matchNames(t.name, [t.ascii, ...t.alts], t.pop < 30_000)]);
}

const json = JSON.stringify({
  source: "GeoNames (geonames.org), CC BY 4.0",
  built: new Date().toISOString().slice(0, 10),
  countries,
  regions: admin1,
  entries,
});
mkdirSync(path.dirname(outFile), { recursive: true });
const gz = gzipSync(json, { level: 9 });
writeFileSync(outFile, gz);
const kinds = [0, 1, 2, 3].map((k) => entries.filter((e) => e[1] === k).length);
console.log(
  `${entries.length} areas (${kinds[0]} countries, ${kinds[1]} regions, ${kinds[2]} sub-regions, ${kinds[3]} towns; ` +
    `${skippedRegions} regions merged with a town, ${skippedSmall} without a town left out) → ${path.relative(root, outFile)} ` +
    `(${(json.length / 1e6).toFixed(1)} MB, ${(gz.length / 1e6).toFixed(1)} MB gzipped)`,
);
