// HTTP routes of the Google Maps search: start, follow, pause and resume a search, suggest
// areas, preview the grid, send the places to the Lead Qualifier. The search itself runs in
// lib/mapsJobRunner.ts.
import { Router, type IRouter } from "express";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import {
  createMapsJob,
  getMapsJob,
  listMapsJobs,
  updateMapsJob,
  pauseMapsJob,
  deleteMapsJob,
  termYield,
  type MapsJob,
} from "../lib/maps/mapsStore.js";
import { generateSmartGrid, generateGridFromBbox, type AreaInput, type GridCell, type MapsScope } from "../lib/maps/geoGrid.js";
import { resolveArea, suggestOsmAreas } from "../lib/maps/areas.js";
import { suggestPlaces } from "../lib/maps/gazetteer.js";
import { ALL_FIELDS, type MapsField, type MapsLead } from "../lib/maps/googleMapsCrawler.js";
import { getIcp } from "../lib/icpStore.js";
import { createBatch } from "../lib/qualify/qualifyStore.js";
import { runQualifyBatch } from "../lib/qualify/qualifyRunner.js";
import { localiseTerms, termSynonyms } from "../lib/maps/translateTerms.js";
import { type PlaceRelevance } from "../lib/maps/searchProfile.js";
import { relevanceOf, relevanceTerms } from "../lib/maps/relevance.js";
import { MAX_JOB_CELLS, startMapsJob } from "../lib/maps/mapsJobRunner.js";
import { findTigapoLocation } from "../lib/tigapoLocations.js";

const router: IRouter = Router();

router.use(apiKeyMiddleware);

/** "Paris" (typed) or { label: "Paris", osmId: "R7444" } (picked in the suggestions). */
function parseAreaInput(raw: unknown): AreaInput[] {
  if (typeof raw === "string") return raw.trim() ? [{ label: raw.trim() }] : [];
  if (raw && typeof raw === "object") {
    const { label, osmId } = raw as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim()) return [];
    return [{ label: label.trim(), osmId: typeof osmId === "string" && osmId.trim() ? osmId.trim() : undefined }];
  }
  return [];
}

router.post("/maps/search", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  // Accept searchTerms[] (new) or legacy searchTerm string
  let searchTerms: string[] = [];
  if (Array.isArray(body.searchTerms) && body.searchTerms.length > 0) {
    searchTerms = body.searchTerms.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (body.searchTerm && typeof body.searchTerm === "string") {
    searchTerms = [body.searchTerm.trim()];
  }
  if (searchTerms.length === 0) {
    res.status(400).json({ error: "searchTerms is required" });
    return;
  }

  const rawFields = Array.isArray(body.selectedFields) ? body.selectedFields : ALL_FIELDS;
  const selectedFields = rawFields.filter((f): f is MapsField =>
    ALL_FIELDS.includes(f as MapsField),
  );
  const label = typeof body.label === "string" ? body.label.trim() || undefined : undefined;

  // Accept areas[] (new) or legacy area string. An area is free text, or a suggestion picked
  // in the list: { label, osmId } (exact OpenStreetMap area, see areas.ts).
  let areas: AreaInput[] = [];
  if (Array.isArray(body.areas) && body.areas.length > 0) {
    areas = (body.areas as unknown[]).flatMap(parseAreaInput);
  } else {
    const legacy = String(body.area ?? body.location ?? "").trim();
    if (legacy) areas = [{ label: legacy }];
  }

  const rawBbox = body.bbox as Record<string, unknown> | undefined;
  const hasBbox = rawBbox && typeof rawBbox === "object" &&
    ["minLat", "maxLat", "minLng", "maxLng"].every((k) => k in rawBbox!);

  if (areas.length === 0 && !hasBbox) {
    res.status(400).json({ error: "area or bbox is required" });
    return;
  }

  // Build one cell grid per area (+ one for bbox if provided)
  type AreaGrid = { location: string; countryCode?: string; cells: GridCell[] };
  const areaGrids: AreaGrid[] = [];

  try {
    if (hasBbox) {
      const bbox = {
        minLat: Number(rawBbox!.minLat), maxLat: Number(rawBbox!.maxLat),
        minLng: Number(rawBbox!.minLng), maxLng: Number(rawBbox!.maxLng),
      };
      areaGrids.push({ location: label || "Custom area", cells: generateGridFromBbox(bbox, searchTerms[0]) });
    }
    // Keep the full grid density for every term: Google only lists the top places per
    // search, so larger cells lose venues (Chicago, 7 terms: 28 cells found far fewer
    // leads than the full 140).
    for (const area of areas) {
      const cells = await generateSmartGrid(area, searchTerms[0]);
      // Already resolved by the grid (cached): its country picks the search languages.
      const resolved = await resolveArea({ osmId: area.osmId, text: area.label });
      areaGrids.push({ location: area.label, countryCode: resolved?.countryCode, cells });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
    return;
  }

  // Apply cell selection only when there's exactly one area (single preview)
  const rawSelected = body.selectedCellIndices;
  const selSet = Array.isArray(rawSelected) && rawSelected.length > 0 && areaGrids.length === 1
    ? new Set(rawSelected.map(Number))
    : null;

  const scope = "city" as MapsScope;

  const MAX_CELLS = MAX_JOB_CELLS;

  // Each term in the area's language(s) (Japan: ゲームセンター), plus the term as typed: in Paris
  // "salle d'arcade" finds most venues, but "arcade" adds real ones Google only tags in English
  // (VR arcades, chains, game shops).
  const localTermsByArea = await Promise.all(
    areaGrids.map(({ location: loc, countryCode }) => localiseTerms(searchTerms, loc, countryCode)),
  );

  // One combined job — flatten all (area × term) cells into a single cell list.
  // Each cell carries its own searchTerm override (localised) so the scraper uses the right query.
  // The job itself may add cells for the main Google category once it has learned it
  // (see runMapsJob / searchProfile.ts).
  const allCells = areaGrids.flatMap(({ cells }, areaIndex) => {
    const localTerms = localTermsByArea[areaIndex].length ? localTermsByArea[areaIndex] : searchTerms;
    const resolvedCells = selSet
      ? cells.map((cell, idx) => selSet.has(idx) ? cell : { ...cell, status: "skipped" as const })
      : cells;
    return localTerms.flatMap((term) =>
      resolvedCells.map((c) => ({ ...c, searchTerm: term, label: localTerms.length > 1 ? `${term} — ${c.label}` : c.label })),
    );
  });

  const activeCells = allCells.filter((c) => c.status !== "skipped");
  if (activeCells.length > MAX_CELLS) {
    res.status(400).json({
      error: `Too many grid cells: ${activeCells.length} (max ${MAX_CELLS}). Reduce the number of areas or search terms, or use cell selection to limit the area.`,
    });
    return;
  }

  // Re-index cells so indices are sequential across the combined list
  const indexedCells = allCells.map((c, i) => ({ ...c, index: i }));

  const combinedLabel = label || searchTerms.join(", ");
  const combinedLocation = areas.map((a) => a.label).join(", ") || (label ?? "Custom area");

  const job = createMapsJob(
    { searchTerm: searchTerms[0], scope, location: combinedLocation, selectedFields, label: combinedLabel },
    indexedCells,
  );

  setImmediate(() => startMapsJob(job.jobId));

  res.status(202).json({
    jobId: job.jobId,
    jobIds: [job.jobId],
    status: "pending",
    totalCells: job.totalCells,
    jobCount: 1,
    termCount: searchTerms.length,
    message: `Maps search started. ${job.totalCells} grid cell(s) to process.`,
  });
});

/**
 * Countries, regions, departments and towns matching what the user is typing: instant, from the
 * area list. `source=osm` asks OpenStreetMap instead (districts, small towns; takes seconds).
 */
router.get("/maps/areas/suggest", async (req, res) => {
  const q = String(req.query.q ?? "");
  if (req.query.source === "osm") {
    const lang = String(req.query.lang ?? "en");
    res.json({ suggestions: await suggestOsmAreas(q, lang) });
    return;
  }
  res.json({ suggestions: suggestPlaces(q) });
});

router.post("/maps/preview-grid", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const rawBbox = body.bbox as Record<string, unknown> | undefined;
  try {
    let cells;
    if (rawBbox && typeof rawBbox === "object") {
      const bbox = {
        minLat: Number(rawBbox.minLat),
        maxLat: Number(rawBbox.maxLat),
        minLng: Number(rawBbox.minLng),
        maxLng: Number(rawBbox.maxLng),
      };
      cells = generateGridFromBbox(bbox, "preview");
    } else {
      const area = String(body.area ?? body.location ?? "").trim();
      const osmId = typeof body.osmId === "string" ? body.osmId : undefined;
      cells = await generateSmartGrid({ label: area, osmId }, "preview");
    }
    res.json({ cells, count: cells.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});


const RELEVANCE_RANK: Record<PlaceRelevance, number> = { match: 0, other: 1, offTopic: 2 };

/**
 * Each place with its relevance to the search (see placeRelevance). "offTopic" places stay stored
 * (the rule can change, and they can be checked) but are left out of the list, export and qualifying.
 */
function withRelevance(job: MapsJob): (MapsLead & { relevance: PlaceRelevance })[] {
  const terms = relevanceTerms(job);
  return job.results.map((lead) => ({ ...lead, relevance: relevanceOf(lead, terms) }));
}

/** Places shown in the list (not off-topic), per job, recomputed only when the job changed. */
const shownCounts = new Map<string, { updatedAt: string; count: number }>();
function shownLeadCount(job: MapsJob): number {
  const cached = shownCounts.get(job.jobId);
  if (cached?.updatedAt === job.updatedAt) return cached.count;
  const count = withRelevance(job).filter((lead) => lead.relevance !== "offTopic").length;
  shownCounts.set(job.jobId, { updatedAt: job.updatedAt, count });
  return count;
}

router.get("/maps", (_req, res) => {
  const jobs = listMapsJobs().map((job) => {
    const { results: _r, cells: _c, ...rest } = job;
    return { ...rest, shownLeads: shownLeadCount(job) };
  });
  res.json({ jobs });
});

router.get("/maps/:jobId", (req, res) => {
  const job = getMapsJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }
  // Each place also says whether it is already a Tigapo location (see tigapoLocations.ts).
  const results = withRelevance(job).map((lead) => ({ ...lead, tigapo: findTigapoLocation(lead) }));
  const shownIds = new Set(results.filter((lead) => lead.relevance !== "offTopic").map((lead) => lead.id));
  res.json({ ...job, results, termYield: termYield(job, (lead) => shownIds.has(lead.id)) });
});

router.post("/maps/:jobId/pause", (req, res) => {
  const ok = pauseMapsJob(req.params.jobId);
  if (!ok) {
    res.status(400).json({ error: "Job not found or not running" });
    return;
  }
  res.json({ ok: true });
});

/** What the qualifier gets for a Maps place: its website when it has one, and what Google Maps says of it. */
function toQualifyInput(lead: MapsLead) {
  const notes = [
    lead.rating != null
      ? `Google Maps rating ${lead.rating}★${lead.reviewCount != null ? ` from ${lead.reviewCount} reviews` : ""}`
      : "",
    lead.phone ? `phone ${lead.phone}` : "",
  ].filter(Boolean).join("; ");
  return {
    name: lead.name,
    url: lead.website ?? "",
    category: lead.category,
    city: lead.address,
    notes: notes || undefined,
    lat: lead.lat,
    lng: lead.lng,
  };
}

/**
 * Sends the job's places to the Lead Qualifier: the ones in `leadIds`, or every place of the list
 * (off-topic places left out). Places without a website are qualified too (from their name,
 * category and Google Maps data); the places matching the search go first.
 */
router.post("/maps/:jobId/qualify-all", (req, res) => {
  const { jobId } = req.params;
  const job = getMapsJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }

  const body = (req.body ?? {}) as { leadIds?: unknown };
  const wanted = Array.isArray(body.leadIds) ? new Set(body.leadIds.map(String)) : null;
  const eligibleLeads = withRelevance(job)
    .filter((lead) => lead.name && (wanted ? wanted.has(lead.id) : lead.relevance !== "offTopic"))
    .sort((a, b) => RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance]);

  if (eligibleLeads.length === 0) {
    res.status(409).json({ error: "No places to qualify" });
    return;
  }

  const icp = getIcp();
  const batch = createBatch(eligibleLeads.map(toQualifyInput), icp.name);

  setImmediate(() => {
    runQualifyBatch(batch.batchId);
  });

  res.status(202).json({
    ok: true,
    batchId: batch.batchId,
    count: eligibleLeads.length,
    message: `Qualify batch started for ${eligibleLeads.length} lead(s)`,
  });
});

router.post("/maps/:jobId/resume", (req, res) => {
  const job = getMapsJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "paused") {
    res.status(400).json({ error: "Job is not paused" });
    return;
  }

  updateMapsJob(job.jobId, { status: "running" });

  setImmediate(() => {
    startMapsJob(job.jobId);
  });

  res.status(202).json({
    jobId: job.jobId,
    status: "running",
    message: "Job resumed.",
  });
});

/** Deletes a finished, paused or failed search and its places. A running search must be paused first. */
router.delete("/maps/:jobId", async (req, res) => {
  try {
    const outcome = await deleteMapsJob(req.params.jobId);
    if (outcome === "not-found") {
      res.status(404).json({ error: "Maps job not found" });
      return;
    }
    if (outcome === "running") {
      res.status(409).json({ error: "This search is running: pause it before deleting it" });
      return;
    }
    shownCounts.delete(req.params.jobId);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: `Could not delete the search (database unreachable): ${err instanceof Error ? err.message : String(err)}` });
  }
});


export default router;
