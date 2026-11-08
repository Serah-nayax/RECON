// The Google Maps search engine: runs a job's grid cells in a headless browser, splits the
// cells Google says are full, learns Google's own category names for the search terms, pauses
// when the internet drops and resumes jobs interrupted by a restart. The HTTP routes are in
// routes/maps.ts.
import {
  PlaywrightCrawler,
  Configuration,
  type PlaywrightLaunchContext,
} from "@crawlee/playwright";
import { MemoryStorage } from "@crawlee/memory-storage";
import { chromium } from "playwright";
import { lookup } from "dns/promises";
import { availableParallelism, totalmem } from "os";
import {
  getMapsJob,
  listMapsJobs,
  updateMapsJob,
  updateMapsLead,
  updateCell,
  addMapsLeads,
  pauseMapsJob,
  getAbortSignal,
  clearAbortSignal,
  isJobPausedOrDone,
  takeInterruptedJobIds,
  jobSearchTerms,
  type MapsJobConfig,
} from "./mapsStore.js";
import type { BoundingBox, GridCell } from "./geoGrid.js";
import { zoomForCell } from "./geoGrid.js";
import { resolveArea, isInArea, rectTouchesArea, type ResolvedArea } from "./areas.js";
import {
  scrapeGoogleMapsCell,
  scrapeGoogleMapsDetailPage,
  buildGoogleMapsSearchUrl,
  DETAIL_FIELDS,
  MapsNoResultsError,
  isLimitedView,
  lastReplayStats,
  listEndSeen,
  lastPhaseTimings,
  markNavigationStart,
  collectSearchResponses,
  type MapsField,
  type MapsLead,
} from "./googleMapsCrawler.js";
import { logger } from "../logger.js";
import { allowSleep, keepAwake } from "./keepAwake.js";
import { isOffTopicPlace, learnExpansions, TOP_RESULTS } from "./searchProfile.js";

const NETWORK_POLL_MS = 10_000;
/**
 * Browser pages searching cells at once (one job runs at a time, see startMapsJob). With map
 * tiles blocked, 8 pages took Lyon arcade from 7.3 to 5.3 min (with the parallel probes) and
 * Japan laser tag kept every venue; measured on 14 threads / 15 GB. Smaller machines keep 4:
 * at 8 the CPU saturated (Lyon: 9.5 min) and a 4 GB server runs short of memory.
 * MAPS_CONCURRENCY sets it by hand.
 */
const MAPS_CONCURRENCY = (() => {
  const forced = Number(process.env.MAPS_CONCURRENCY);
  if (forced > 0) return forced;
  const threads = availableParallelism();
  const memoryGb = totalmem() / 1024 ** 3;
  return threads >= 8 && memoryGb >= 12 ? 8 : 4;
})();
logger.info({ pages: MAPS_CONCURRENCY, threads: availableParallelism(), memoryGb: Math.round(totalmem() / 1024 ** 3) }, "Maps: browser pages per search");
/** Skip the map tiles of each cell page (the list is all RECON reads). MAPS_BLOCK_TILES=0 loads them. */
const BLOCK_MAP_TILES = process.env.MAPS_BLOCK_TILES !== "0";
const NETWORK_PAUSE_MESSAGE = "Internet connection lost: the search resumes automatically when it is back.";

/** A local DNS lookup (no request to Google): false when this machine is offline or asleep. */
async function networkIsUp(): Promise<boolean> {
  try {
    await Promise.race([
      lookup("www.google.com"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), 5000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

const networkWatchers = new Set<string>();

/** Resumes a job paused by NETWORK_PAUSE_MESSAGE as soon as the connection is back. */
function watchNetworkThenResume(jobId: string): void {
  if (networkWatchers.has(jobId)) return;
  networkWatchers.add(jobId);
  void (async () => {
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, NETWORK_POLL_MS));
        const job = getMapsJob(jobId);
        // Resumed, deleted or changed by the user meanwhile: nothing left to do.
        if (!job || job.status !== "paused" || job.error !== NETWORK_PAUSE_MESSAGE) return;
        if (await networkIsUp()) {
          logger.info({ jobId }, "Maps: internet connection is back, resuming the job");
          updateMapsJob(jobId, { status: "running", error: null });
          startMapsJob(jobId);
          return;
        }
      }
    } finally {
      networkWatchers.delete(jobId);
    }
  })();
}

/**
 * The machine went offline (Wi-Fi/VPN drop, laptop asleep): pause the job cleanly instead of
 * burning every cell's retries into a dead connection, and resume it when the network is back.
 */
function pauseUntilNetworkReturns(jobId: string): void {
  if (!pauseMapsJob(jobId)) return;
  updateMapsJob(jobId, { error: NETWORK_PAUSE_MESSAGE });
  logger.warn({ jobId }, "Maps: internet connection lost, job paused until it is back");
  watchNetworkThenResume(jobId);
}

const activeMapRuns = new Map<string, Promise<void>>();
let mapsRunTail: Promise<void> = Promise.resolve();

/** Queues a job's search (one job runs at a time). */
export function startMapsJob(jobId: string): void {
  // One Crawlee Maps job at a time keeps the process-wide browser-page ceiling
  // at maxConcurrency rather than multiplying it across simultaneous jobs.
  // The PC stays awake from the moment a search is queued until it stops (see keepAwake.ts).
  keepAwake(`maps:${jobId}`);
  const run = mapsRunTail
    .catch(() => { /* a prior run already recorded its failure */ })
    .then(() => runMapsJob(jobId))
    .finally(() => {
      allowSleep(`maps:${jobId}`);
      if (activeMapRuns.get(jobId) === run) activeMapRuns.delete(jobId);
    });
  mapsRunTail = run.catch(() => { /* runMapsJob records failures in the job */ });
  activeMapRuns.set(jobId, run);
}

/** Resume searches that were interrupted by a server restart (instead of leaving them "paused"). */
export function resumeInterruptedMapsJobs(): void {
  for (const jobId of takeInterruptedJobIds()) {
    logger.info({ jobId }, "Resuming Maps job interrupted by restart");
    updateMapsJob(jobId, { status: "running", error: null });
    startMapsJob(jobId);
  }
  // Jobs paused by a network drop before the restart still resume on their own.
  for (const job of listMapsJobs()) {
    if (job.status === "paused" && job.error === NETWORK_PAUSE_MESSAGE) watchNetworkThenResume(job.jobId);
  }
}

function getSystemChromiumPath(): string | undefined {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    return execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function buildCrawleeLaunchContext(): PlaywrightLaunchContext {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-zygote",
    "--disable-features=site-per-process",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
  ];

  const proxyUrl = process.env.MAPS_PROXY_URL?.trim() || undefined;
  const launchOptions: import("playwright").LaunchOptions = { headless: true, args };

  // Use system Chromium if available (env var takes priority, then auto-discover via PATH)
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? getSystemChromiumPath();
  if (executablePath) {
    launchOptions.executablePath = executablePath;
    logger.info({ executablePath }, "Maps Crawlee: using system Chromium");
  }

  if (proxyUrl) {
    logger.info(
      { proxyUrl: proxyUrl.replace(/:\/\/.*@/, "://<redacted>@") },
      "Maps Crawlee: using proxy",
    );
  }

  return {
    launcher: chromium,
    useIncognitoPages: true,
    ...(proxyUrl ? { proxyUrl } : {}),
    launchOptions,
  };
}

// A country is ~50-200 cells of 1° per term before splitting (Japan with 2 terms in 2 languages:
// ~400). Large enough for that; a world-sized request still gets a clear error instead.
export const MAX_JOB_CELLS = 2000;
/** Longest a term's probe may take before the job goes on without it. */
const PROBE_TIMEOUT_MS = Number(process.env.MAPS_PROBE_TIMEOUT_MS ?? 120_000);

/**
 * The extra searches for the job's terms (see searchProfile.ts). Each term is searched once in
 * the middle of the area and its dominant categories are read from Google's ranking. If the
 * probe fails, the job simply has no extra searches.
 */
async function learnJobExpansions(
  jobId: string,
  config: MapsJobConfig,
  cells: GridCell[],
  signal: AbortSignal,
): Promise<string[]> {
  const userCells = cells.filter((c) => c.status !== "skipped" && !c.autoTerm);
  const termOf = (c: GridCell) => c.searchTerm || config.searchTerm;
  const learnTerms = [...new Set(userCells.map(termOf))];
  const expansions = new Set<string>();
  // The cell nearest the middle of the term's grid: its first results are the best matches.
  const middleCell = (term: string) => {
    const own = userCells.filter((c) => termOf(c) === term);
    const lat = own.reduce((s, c) => s + c.lat, 0) / own.length;
    const lng = own.reduce((s, c) => s + c.lng, 0) / own.length;
    const dist = (c: GridCell) => (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    return own.reduce((best, c) => (dist(c) < dist(best) ? c : best));
  };
  // The whole area in one view: Google then ranks the best matches from all of it. Used when the
  // middle cell is too quiet (Japan, laser tag: the middle of the country listed 5 places, the
  // job fell back on another job's terms and missed Round 1, Taito, namco: 34 venues).
  const wholeAreaCell = (term: string): GridCell => {
    const own = userCells.filter((c) => termOf(c) === term);
    const middle = middleCell(term);
    const half = middle.halfDeg ?? 0;
    const minLat = Math.min(...own.map((c) => c.lat)) - half, maxLat = Math.max(...own.map((c) => c.lat)) + half;
    const minLng = Math.min(...own.map((c) => c.lng)) - half, maxLng = Math.max(...own.map((c) => c.lng)) + half;
    const span = Math.max(maxLat - minLat, maxLng - minLng);
    return { ...middle, lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2, halfDeg: span / 2, zoom: zoomForCell(span) };
  };

  const launch = buildCrawleeLaunchContext();
  const proxy = launch.proxyUrl ? new URL(launch.proxyUrl) : null;
  let browser: import("playwright").Browser | null = null;
  try {
    browser = await chromium.launch({
      ...launch.launchOptions,
      ...(proxy
        ? {
            proxy: {
              server: `${proxy.protocol}//${proxy.host}`,
              username: decodeURIComponent(proxy.username) || undefined,
              password: decodeURIComponent(proxy.password) || undefined,
            },
          }
        : {}),
    });
    const probes: Array<{ term: string; places: MapsLead[] }> = [];
    let next = 0;
    // Probes wait on fixed page delays, not on the CPU: several terms can be read at once.
    // MAPS_PROBE_CONCURRENCY lowers it if Google starts blocking the probes.
    const probeConcurrency = Number(process.env.MAPS_PROBE_CONCURRENCY ?? 5);
    await Promise.all(
      Array.from({ length: Math.min(probeConcurrency, learnTerms.length) }, async () => {
        const page = await browser!.newPage({ locale: "en-US" });
        while (next < learnTerms.length && !signal.aborted) {
          const term = learnTerms[next++];
          // A probe that hangs must not hold up the whole job: after the limit it is dropped and
          // the term keeps its own words (the fallback profile below).
          const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
          const probe = (cell: GridCell) =>
            scrapeGoogleMapsCell(
              term, config.scope, config.location, cell, ["category"], page, probeSignal,
              undefined, false, TOP_RESULTS,
            ).catch((err) => {
              logger.warn({ jobId, term, err: err instanceof Error ? err.message : String(err) }, "Search profile probe failed");
              return [] as MapsLead[];
            });
          let places = await probe(middleCell(term));
          // A short list: the middle of the area is quiet (or Google cut it). The whole area is
          // read too and the longer list is kept; city middles fill their 20 and skip this.
          if (places.length < TOP_RESULTS && userCells.filter((c) => termOf(c) === term).length > 1 && !probeSignal.aborted) {
            const wide = await probe(wholeAreaCell(term));
            logger.info({ jobId, term, middlePlaces: places.length, wholeAreaPlaces: wide.length }, "Search profile: middle cell was short, read the whole area");
            if (wide.length > places.length) places = wide;
          }
          probes.push({ term, places });
        }
        await page.close().catch(() => {});
      }),
    );
    for (const { term, places } of probes) {
      let found = learnExpansions(term, places);
      let source = "probe";
      // Google sometimes answers the probe with a short "limited view" list: the same search
      // then ran with 0 extra terms (53 leads instead of 68-79). The last job's terms are reused.
      if (found.length === 0) {
        found = previousExpansions(jobId, term);
        if (found.length) source = "previous job";
      }
      for (const e of found) expansions.add(e);
      logger.info(
        { jobId, term, expansions: found, source, probePlaces: places.length, probeCategories: places.slice(0, 8).map((p) => p.category ?? null) },
        "Search expansions learned",
      );
    }
    return [...expansions];
  } catch (err) {
    logger.warn({ jobId, err: err instanceof Error ? err.message : String(err) }, "Search expansions skipped");
    return [...expansions];
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * The extra terms the latest other job searched for this term. Only jobs with this single term
 * count: with several terms, which term an extra search came from is not recorded.
 */
function previousExpansions(jobId: string, term: string): string[] {
  const key = term.toLowerCase().trim();
  const previous = listMapsJobs()
    .filter((job) => job.jobId !== jobId)
    .map((job) => {
      const termOf = (c: GridCell) => (c.searchTerm || job.config.searchTerm).toLowerCase().trim();
      // Jobs from before autoTerm existed: the extra terms are those other than the job's own term.
      if (!job.cells.some((c) => c.autoTerm)) {
        const extra = [...new Set(job.cells.filter((c) => c.status !== "skipped").map(termOf))].filter((t) => t !== key);
        return { job, single: job.config.searchTerm.toLowerCase().trim() === key, extra: extra.slice(0, 2) };
      }
      const own = job.cells.filter((c) => !c.autoTerm && c.status !== "skipped");
      const terms = new Set(own.map(termOf));
      const extra = [...new Set(job.cells.filter((c) => c.autoTerm && c.searchTerm).map((c) => c.searchTerm!))];
      return { job, single: terms.size === 1 && terms.has(key), extra };
    })
    .filter((x) => x.single && x.extra.length > 0)
    .sort((a, b) => String(b.job.createdAt).localeCompare(String(a.job.createdAt)));
  return previous[0]?.extra ?? [];
}

/** Adds one cell per grid square for each expansion term, within the cell limit. */
function addExpansionCells(jobId: string, cells: GridCell[], expansions: string[]): void {
  const squares = new Map<string, GridCell>();
  for (const c of cells) {
    if (c.status === "skipped" || c.autoTerm) continue;
    squares.set(`${c.lat},${c.lng},${c.halfDeg ?? 0},${c.namedLocation ?? ""}`, c);
  }
  let active = cells.filter((c) => c.status !== "skipped").length;
  const existing = new Set(cells.map((c) => (c.searchTerm ?? "").toLowerCase()));
  for (const term of expansions) {
    if (existing.has(term.toLowerCase())) continue; // already searched (or a resumed job)
    if (active + squares.size > MAX_JOB_CELLS) break;
    for (const square of squares.values()) {
      const place = square.label.includes(" — ") ? square.label.split(" — ").slice(1).join(" — ") : square.label;
      cells.push({
        ...square,
        index: cells.length,
        searchTerm: term,
        label: `${term} — ${place}`,
        status: "pending",
        leadsFound: 0,
        error: undefined,
        autoTerm: true,
      });
    }
    active += squares.size;
  }
  updateMapsJob(jobId, { cells, totalCells: active });
}

// Google never lists more than ~120 places for one search, so a cell that fills its list
// still hides places. Such a cell is cut into four quarters (one zoom level closer), each
// searched again; quarters that fill up are cut again.
// - Region and country cells (wider than CITY_HALF_DEG) are cut as often as needed, down to
//   city-sized cells: a 1° cell over Tokyo must reach street level to list every venue.
// - City-sized cells then follow the city limits below (counted by cityDepth), down to ~500 m.
const SATURATED_CELL_PLACES = 100;
const MIN_SPLIT_HALF_DEG = 0.004;
const MAX_SPLIT_DEPTH = 2;
/** Half-width (degrees) under which a cell is city-sized: ~10 km wide. */
const CITY_HALF_DEG = 0.05;
const MAX_CELLS_WITH_SPLITS = 4000;
/** Under Google's limited view: a cell listing this many places likely hides more. */
const LIMITED_BUSY_CELL_PLACES = 20;
/** A list this short with no end marker and no further page may be Google's first page only (see the cell handler). */
const PAGE_CUT_MAX_PLACES = 22;
/**
 * Quick pass first: every grid cell is searched once before any full cell is cut. Paris arcade
 * (Nov 2026): the grid alone took 2.4-3.8 min and found as many on-topic places as 14-23 min
 * runs that cut cells as they went, so the full list comes in minutes and the quarters (which
 * only add places, never remove any) follow as a refinement. MAPS_DEFER_SPLITS=0 cuts as before.
 */
const DEFER_SPLITS = process.env.MAPS_DEFER_SPLITS !== "0";
/** Under limited view a city-sized cell is cut only once: four times the requests at most for those cells. */
const LIMITED_MAX_SPLIT_DEPTH = 1;

/** City-level splits already done (jobs from before cityDepth: their depth). */
const cityDepthOf = (cell: GridCell) => cell.cityDepth ?? cell.depth ?? 0;

/** Should this finished cell be searched again in four quarters? */
function cellNeedsSplit(cell: GridCell, rawPlaces: number, places: number, limitedView: boolean): boolean {
  // A full list (100+) means Google cut it: the cell may hide more wherever those places are,
  // unless the map Google showed was nearly empty (Northumberland: 145 listed, none in view,
  // filled from farther away). Paris: counting the view only here dropped 10 of 12 such cuts,
  // which earlier runs had made for 9-23 more places.
  if (rawPlaces >= SATURATED_CELL_PLACES && places >= LIMITED_BUSY_CELL_PLACES) return true;
  // A region-sized cell is searched zoomed far out, where Google ranks only the best-known
  // places: with 20+ of them there are likely more, banner or not.
  if ((cell.halfDeg ?? 0) > CITY_HALF_DEG) return places >= LIMITED_BUSY_CELL_PLACES;
  return limitedView && places >= LIMITED_BUSY_CELL_PLACES && cityDepthOf(cell) < LIMITED_MAX_SPLIT_DEPTH;
}

/**
 * Places Google listed within the map it was showing for the cell. The view is 3-4 times
 * wider than the cell (Paris: counting only the cell's own square dropped 70% of the useful
 * cuts and 20% of the venues), so it is computed from the browser window and the zoom, and
 * counted twice as wide on each side to stay on the safe side (the results panel shifts the
 * map). A place without coordinates is counted; with no window size, every place counts.
 */
function placesInView(
  cell: GridCell,
  viewport: { width: number; height: number } | null,
  places: MapsLead[],
): number {
  if (!viewport) return places.length;
  const degPerPx = 360 / (256 * 2 ** cell.zoom);
  const halfLng = viewport.width * degPerPx;
  const halfLat = viewport.height * degPerPx * Math.cos((cell.lat * Math.PI) / 180);
  return places.filter(
    (p) => p.lat == null || p.lng == null ||
      (Math.abs(p.lat - cell.lat) <= halfLat && Math.abs(p.lng - cell.lng) <= halfLng),
  ).length;
}

/**
 * Appends the four quarters of a saturated cell; returns their indexes (none when not split).
 * Quarters entirely off the searched area (sea, neighbouring country) are not searched.
 */
function splitSaturatedCell(
  jobId: string,
  cells: GridCell[],
  cellIndex: number,
  onArea: (cell: GridCell, rect: BoundingBox) => boolean,
): number[] {
  const cell = cells[cellIndex];
  const half = cell.halfDeg ?? 0;
  const regionSized = half > CITY_HALF_DEG;
  if (!regionSized && (half < MIN_SPLIT_HALF_DEG || cityDepthOf(cell) >= MAX_SPLIT_DEPTH)) return [];
  if (cells.some((c) => c.parentIndex === cellIndex)) return []; // a resumed cell: already cut

  const quarter = half / 2;
  const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    .map(([dy, dx]) => ({
      lat: Math.round((cell.lat + dy * quarter) * 10000) / 10000,
      lng: Math.round((cell.lng + dx * quarter) * 10000) / 10000,
    }))
    .filter(({ lat, lng }) =>
      onArea(cell, { minLat: lat - quarter, maxLat: lat + quarter, minLng: lng - quarter, maxLng: lng + quarter }),
    );
  if (cells.filter((c) => c.status !== "skipped").length + corners.length > MAX_CELLS_WITH_SPLITS) {
    // Never silently: the job shows how many full cells could not be searched in detail.
    updateCell(jobId, cellIndex, { splitSkipped: true });
    logger.warn({ jobId, cellIndex }, "Maps Crawlee: cell list full but the cell budget is spent, places may be missing");
    return [];
  }

  const added: number[] = [];
  corners.forEach(({ lat, lng }, n) => {
    const index = cells.length;
    cells.push({
      ...cell,
      index,
      lat,
      lng,
      zoom: cell.zoom + 1,
      halfDeg: quarter,
      label: `${cell.label} · ¼ ${n + 1}`,
      status: "pending",
      leadsFound: 0,
      rawPlaces: undefined,
      viewPlaces: undefined,
      newLeads: undefined,
      durationMs: undefined,
      phasesMs: undefined,
      limitedView: undefined,
      splitSkipped: undefined,
      error: undefined,
      parentIndex: cellIndex,
      depth: (cell.depth ?? 0) + 1,
      // Counted from the first city-sized cell: a country cell reaching city size starts at 0.
      cityDepth: regionSized ? 0 : cityDepthOf(cell) + 1,
    });
    added.push(index);
  });
  updateMapsJob(jobId, { cells, totalCells: cells.filter((c) => c.status !== "skipped").length });
  logger.info(
    { jobId, cellIndex, depth: (cell.depth ?? 0) + 1, quarters: added.length },
    "Maps Crawlee: cell list full, searching its quarters",
  );
  return added;
}

/** Restarts after a Crawlee crash, per job; reset whenever a restart finishes more cells. */
const crashRestarts = new Map<string, { doneCells: number; attempts: number }>();
const MAX_CRASH_RESTARTS = 3;
/** Jobs whose next run must not probe again: their expansion cells already exist. */
const expansionsAlreadyLearned = new Set<string>();

function cellsFinished(jobId: string): number {
  return getMapsJob(jobId)?.cells.filter((c) => c.status !== "pending" && c.status !== "running").length ?? 0;
}

async function runMapsJob(jobId: string): Promise<void> {
  const job = getMapsJob(jobId);
  if (!job) return;

  updateMapsJob(jobId, { status: "running" });

  const signal = getAbortSignal(jobId);
  const { config, cells } = job;
  // The quick pass is over once refinement cells exist (see DEFER_SPLITS): cells are cut as
  // soon as they fill up again, and the expansion terms were already added by the quick pass.
  const refining = cells.some((c) => c.refinement);
  // Each term's dominant Google categories are searched too (searchProfile.ts). A resumed job
  // learns again but keeps the expansion cells it already has. The probes run while the user's
  // own cells are searched (they used to hold up the whole job ~1 min before the first cell);
  // their cells join the queue when the probes end (see expansionCellsReady below).
  const learnNow = !refining && !expansionsAlreadyLearned.delete(jobId);
  const keepCategory = config.selectedFields.includes("category");
  const scrapeFields: MapsField[] = config.selectedFields;
  const withoutHiddenFields = (leads: MapsLead[]) =>
    keepCategory ? leads : leads.map(({ category: _category, ...lead }) => lead);
  const detailFields = config.selectedFields.filter((field) => DETAIL_FIELDS.includes(field));
  const needsDetails = detailFields.length > 0;
  const storageConfig = new Configuration({
    storageClient: new MemoryStorage({ persistStorage: false }),
    // Crawlee defaults to budgeting only 25% of system RAM, which on a 4 GB
    // Reserved VM makes it think one Chromium tab is "critically overloaded".
    availableMemoryRatio: 0.7,
  });

  type MapsRequestData =
    | { kind: "cell"; cellIndex: number; lat: number; lng: number }
    | { kind: "detail"; leadId: string; lat?: number; lng?: number };

  const pendingCellIndexes = cells
    .map((cell, index) => ({ cell, index }))
    // "running" here means the previous run stopped mid-cell (pause, network drop).
    .filter(({ cell }) => cell.status === "pending" || cell.status === "running")
    .map(({ index }) => index);
  let nextCellCursor = 0;
  const queuedDetailIds = new Set<string>();

  // The areas the user asked for: a place Google lists outside all of them is dropped.
  // OpenStreetMap areas use their outline (Japan, not the sea and Korea around it); drawn
  // rectangles and areas whose outline cannot be fetched use their box. Jobs created before
  // areaBox existed fall back to the grid edges.
  const AREA_EDGE_DEG = 0.002; // about 200 m, so places right on the border line are kept
  const outlines = new Map<string, ResolvedArea>();
  for (const areaId of new Set(cells.flatMap((c) => (c.areaId ? [c.areaId] : [])))) {
    const area = await resolveArea({ osmId: areaId });
    if (area?.polygons.length) outlines.set(areaId, area);
    else logger.warn({ jobId, areaId }, "Area outline unavailable, filtering places by its bounding box");
  }
  const areaBoxes: BoundingBox[] = (() => {
    const unique = new Map(
      cells.flatMap((c) => (c.areaBox && !(c.areaId && outlines.has(c.areaId)) ? [[JSON.stringify(c.areaBox), c.areaBox] as const] : [])),
    );
    if (unique.size || outlines.size) return [...unique.values()];
    const realCells = cells.filter((c) => (c.halfDeg ?? 0) > 0 && !(c.lat === 0 && c.lng === 0));
    if (!realCells.length) return [];
    return [{
      minLat: Math.min(...realCells.map((c) => c.lat - c.halfDeg!)),
      maxLat: Math.max(...realCells.map((c) => c.lat + c.halfDeg!)),
      minLng: Math.min(...realCells.map((c) => c.lng - c.halfDeg!)),
      maxLng: Math.max(...realCells.map((c) => c.lng + c.halfDeg!)),
    }];
  })();
  const filtersByArea = areaBoxes.length > 0 || outlines.size > 0;
  const inSearchedArea = (lat: number, lng: number) =>
    areaBoxes.some((b) =>
      lat >= b.minLat - AREA_EDGE_DEG && lat <= b.maxLat + AREA_EDGE_DEG &&
      lng >= b.minLng - AREA_EDGE_DEG && lng <= b.maxLng + AREA_EDGE_DEG,
    ) || [...outlines.values()].some((area) => isInArea(area, lat, lng, AREA_EDGE_DEG));
  /** Does a quarter of this cell touch its area? (cells without an outline: always) */
  const quarterOnArea = (cell: GridCell, rect: BoundingBox) => {
    const area = cell.areaId ? outlines.get(cell.areaId) : undefined;
    return area ? rectTouchesArea(area, rect) : true;
  };

  const cellRequest = (cellIndex: number) => {
    const cell = cells[cellIndex];
    const rawUrl = buildGoogleMapsSearchUrl(
      config.scope,
      cell.searchTerm || config.searchTerm,
      config.location,
      cell,
    );
    const url = rawUrl.includes("?") ? `${rawUrl}&hl=en&gl=au` : `${rawUrl}?hl=en&gl=au`;
    return {
      url,
      uniqueKey: `cell:${jobId}:${cellIndex}`,
      userData: {
        kind: "cell",
        cellIndex,
        lat: cell.lat,
        lng: cell.lng,
      } satisfies MapsRequestData,
    };
  };

  const detailRequest = (lead: MapsLead, cellIndex?: number) => ({
    url: lead.mapsUrl!,
    uniqueKey: `detail:${jobId}:${lead.id}`,
    userData: {
      kind: "detail",
      leadId: lead.id,
      lat: cellIndex == null ? lead.lat : cells[cellIndex]?.lat,
      lng: cellIndex == null ? lead.lng : cells[cellIndex]?.lng,
    } satisfies MapsRequestData,
  });

  // Cell chains (see PARALLEL_CELLS) that found the queue empty: revived when the expansion
  // cells arrive.
  let idleChains = 0;
  const takeNextCellRequest = () => {
    if (nextCellCursor >= pendingCellIndexes.length) {
      idleChains++;
      return null;
    }
    return cellRequest(pendingCellIndexes[nextCellCursor++]);
  };

  // Cells already given their one retry (see failedRequestHandler).
  const retriedCells = new Set<number>();
  let crawler: PlaywrightCrawler;
  crawler = new PlaywrightCrawler(
    {
      launchContext: buildCrawleeLaunchContext(),
      // Pages at once: see MAPS_CONCURRENCY.
      // Pinned: Crawlee's autoscaler read short event-loop stalls (parsing big search
      // answers) as overload and dropped to 1 page, ~40% slower runs (2.6 of 4 on average).
      maxConcurrency: MAPS_CONCURRENCY,
      minConcurrency: MAPS_CONCURRENCY,
      autoscaledPoolOptions: { desiredConcurrency: MAPS_CONCURRENCY },
      maxRequestRetries: 2,
      maxSessionRotations: 3,
      retryOnBlocked: true,
      navigationTimeoutSecs: 35,
      // A busy cell (long scroll, then up to 20 replayed pages) legitimately ran 120 s in the Paris
      // benchmark; cutting it at 150 s threw its places away and retried it from scratch.
      requestHandlerTimeoutSecs: 300,
      useSessionPool: true,
      sessionPoolOptions: {
        maxPoolSize: 20,
        sessionOptions: {
          maxErrorScore: 2,
          maxUsageCount: 15,
        },
      },
      browserPoolOptions: {
        useFingerprints: true,
        maxOpenPagesPerBrowser: MAPS_CONCURRENCY,
        retireBrowserAfterPageCount: 12,
      },
      preNavigationHooks: [
        async ({ page, request }, gotoOptions) => {
          const data = request.userData as MapsRequestData;
          // Record Google's search responses from the first byte: they carry phone/website.
          if (data.kind === "cell") {
            collectSearchResponses(page);
            markNavigationStart(page);
          }
          const latitude = typeof data.lat === "number" ? data.lat : -34.9285;
          const longitude = typeof data.lng === "number" ? data.lng : 138.6007;
          await page.context().grantPermissions(["geolocation"], { origin: "https://www.google.com" });
          await page.context().setGeolocation({ latitude, longitude });
          await page.setExtraHTTPHeaders({ "Accept-Language": "en,en-AU;q=0.9" });
          await page.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          });
          await page.route("**/*", async (route) => {
            const req = route.request();
            const resourceType = req.resourceType();
            const reqUrl = req.url();
            const isTelemetry =
              /\/(gen_204|log|csi)\b/.test(reqUrl) ||
              /google-analytics\.com|googletagmanager\.com|doubleclick\.net/.test(reqUrl);
            // Map tiles (~210 requests per cell): RECON reads the results list, never the map, and
            // drawing the map without a GPU is what saturates the CPU (8 pages: each cell 2x slower).
            const isMapTile = BLOCK_MAP_TILES && /^https:\/\/www\.google\.com\/maps\/vt\b/.test(reqUrl);
            if (["image", "font", "media"].includes(resourceType) || isTelemetry || isMapTile) {
              await route.abort();
            } else {
              await route.continue();
            }
          });
          gotoOptions.waitUntil = "domcontentloaded";
          gotoOptions.timeout = 35_000;
        },
      ],
      async requestHandler({ request, page, addRequests, session }) {
        if (signal.aborted || isJobPausedOrDone(jobId)) return;
        const data = request.userData as MapsRequestData;

        if (data.kind === "detail") {
          const current = getMapsJob(jobId);
          const lead = current?.results.find((item) => item.id === data.leadId);
          if (!lead) return;
          const result = await scrapeGoogleMapsDetailPage(lead, config.selectedFields, page);
          if (result.error) {
            session?.markBad();
            throw new Error(result.error);
          }
          updateMapsLead(jobId, result.leadId, {
            ...(result.details ?? {}),
            detailStatus: "done",
            detailError: null,
          });
          logger.info(
            { jobId, leadId: result.leadId, fields: Object.keys(result.details ?? {}) },
            "Maps Crawlee: detail processed",
          );
          return;
        }

        const i = data.cellIndex;
        const cell = cells[i];
        // A retry finds its cell still "running" (set by the failed attempt) and must
        // run again. Skipping a cell must still queue the next one, or this cell chain
        // stops and the job ends up "paused" with cells left.
        if (!cell || (cell.status !== "pending" && cell.status !== "running")) {
          const nextCell = takeNextCellRequest();
          if (nextCell) await addRequests([nextCell], { forefront: true });
          return;
        }
        updateCell(jobId, i, { status: "running", error: undefined });

        const discoveredIds = new Set<string>();
        // Keep places anywhere in the searched area, not only inside this cell: a place
        // that Google lists for a neighbouring cell is still a valid lead.
        // A partial batch skips places whose category has not loaded yet: the final pass stores
        // them once, with their category. Off-topic places (see isOffTopicPlace) are kept: the
        // lead qualifier rates them low, so no real lead is lost to a too strict rule.
        const searchTerms = jobSearchTerms(jobId);
        const filterInBounds = (candidateLeads: MapsLead[], partial = false): MapsLead[] =>
          candidateLeads.flatMap((lead) => {
            if (partial && !lead.category) return [];
            if (filtersByArea && lead.lat != null && lead.lng != null && !inSearchedArea(lead.lat, lead.lng)) return [];
            return [lead];
          });

        const cellStartedAt = Date.now();
        let newInCell = 0;
        let leads: MapsLead[];
        try {
          leads = await scrapeGoogleMapsCell(
            cell.searchTerm || config.searchTerm,
            config.scope,
            config.location,
            cell,
            scrapeFields,
            page,
            signal,
            (partialLeads) => {
              const partialIds = addMapsLeads(jobId, withoutHiddenFields(filterInBounds(partialLeads, true)));
              for (const id of partialIds) discoveredIds.add(id);
              // Not a reason to stop scrolling early: a cell's new places come at the end of
              // Google's list (Paris arcade: positions 70-100, after 40+ known places).
              newInCell += partialIds.length;
            },
            true,
          );
        } catch (err) {
          if (!(err instanceof MapsNoResultsError)) throw err;
          updateCell(jobId, i, { status: "done", leadsFound: 0 });
          logger.info({ jobId, cellIndex: i }, "Maps Crawlee: cell has no results");
          const nextCell = takeNextCellRequest();
          if (nextCell) await addRequests([nextCell], { forefront: true });
          return;
        }

        if (signal.aborted || isJobPausedOrDone(jobId)) {
          updateCell(jobId, i, { status: "pending" });
          return;
        }
        if (leads.length === 0) {
          session?.markBad();
          throw new Error("Google Maps returned no visible business feed; retrying with a fresh Crawlee session");
        }
        const limitedView = isLimitedView(page);
        const viewPlaces = placesInView(cells[i], page.viewportSize(), leads);
        const inBounds = withoutHiddenFields(filterInBounds(leads));
        const insertedIds = addMapsLeads(jobId, inBounds);
        for (const id of insertedIds) discoveredIds.add(id);
        // Leads first stored from the scrolling feed (before Google's search data was
        // parsed) get their phone/website/address now.
        for (const lead of inBounds) {
          if (lead.detailStatus !== "done") continue;
          const { id, name: _name, mapsUrl: _mapsUrl, ...data } = lead;
          updateMapsLead(jobId, id, data);
        }
        // Google sometimes gives a session its first page only: the scroll sends no request
        // for page 2 and the list stops at ~20 with no end marker (Paris arcade: 22 of 111
        // cells, where the same spot listed 80-100 for another term; the venues behind them
        // went missing). The places found are kept; the cell runs once more in a fresh session.
        const firstPageOnly = leads.length >= 15 && leads.length <= PAGE_CUT_MAX_PLACES &&
          !listEndSeen(page) && !lastReplayStats(page);
        const cellData = request.userData as MapsRequestData & { pageCutRetried?: boolean };
        if (firstPageOnly && !cellData.pageCutRetried) {
          cellData.pageCutRetried = true;
          updateCell(jobId, i, { rawPlaces: leads.length, error: "Google stopped at its first page: searching again" });
          logger.info({ jobId, cellIndex: i, rawPlaces: leads.length }, "Maps: cell stopped at Google's first page, retrying in a fresh session");
          session?.retire();
          throw new Error("Google listed only its first page of places; retrying with a fresh session");
        }
        updateCell(jobId, i, { status: "done", leadsFound: inBounds.length, rawPlaces: leads.length, viewPlaces, pageCutRetried: cellData.pageCutRetried || undefined, newLeads: newInCell + insertedIds.length, limitedView, durationMs: Date.now() - cellStartedAt, phasesMs: lastPhaseTimings(page) ?? undefined });
        logger.info(
          {
            jobId,
            cellIndex: i,
            leadsFound: inBounds.length,
            newLeads: newInCell + insertedIds.length,
            rawPlaces: leads.length,
            offTopic: leads.filter((lead) => isOffTopicPlace(lead.category, searchTerms)).length,
            limitedView,
            replay: lastReplayStats(page),
            phasesMs: lastPhaseTimings(page),
            durationMs: Date.now() - cellStartedAt,
          },
          "Maps Crawlee: cell scraped",
        );
        // Raw count, before filtering: a full list means Google had more to show. When Google
        // limits the session it may stop lists early (arcade Jerusalem: at most 32 places instead
        // of 100+ the same morning), so a busy limited cell is cut once too. Long limited lists
        // (Paris: 60-120) are cut as well now that a cell takes ~10s (replayed search requests):
        // the run that did so found the most places (Paris: 94% of known venues vs 87%).
        // Region and country cells with 20+ places are cut until they are city-sized
        // (cellNeedsSplit): a 1° cell listing 20 places says little about the rest of it.
        // The other rules count only places within the map Google was showing: when that view
        // holds fewer places than the list, Google fills the list from farther away (Northumberland
        // arcade: 1.5 km views listing the same 145 places, none in view; 57 cells, 1 new
        // place), so the raw count no longer says the cell hides more.
        if (cellNeedsSplit(cells[i], leads.length, viewPlaces, limitedView)) {
          if (DEFER_SPLITS && !refining) {
            // Its places are already stored; the quarters run after the quick pass.
            updateCell(jobId, i, { splitDeferred: true });
          } else {
            const quarters = splitSaturatedCell(jobId, cells, i, quarterOnArea);
            if (quarters.length) await addRequests(quarters.map(cellRequest), { forefront: true });
          }
        }

        if (needsDetails) {
          const detailLeads = inBounds.filter(
            (lead) =>
              discoveredIds.has(lead.id) && lead.mapsUrl && !queuedDetailIds.has(lead.id) &&
              // Already complete from Google's search data: no place page needed.
              getMapsJob(jobId)?.results.find((r) => r.id === lead.id)?.detailStatus !== "done",
          );
          for (const lead of detailLeads) {
            queuedDetailIds.add(lead.id);
            updateMapsLead(jobId, lead.id, { detailStatus: "running", detailError: null });
          }
          // Details go to the back of the queue: they fill in on free slots while the
          // search keeps moving, instead of every cell waiting for the previous cell's details.
          if (detailLeads.length > 0) {
            await addRequests(detailLeads.map((lead) => detailRequest(lead, i)));
          }
        }

        const nextCell = takeNextCellRequest();
        if (nextCell) await addRequests([nextCell], { forefront: true });
      },
      // Before Crawlee's own retries: when the machine is offline, pause the job instead of
      // retrying into a dead connection (each failed navigation costs navigationTimeoutSecs).
      async errorHandler() {
        if (!signal.aborted && !(await networkIsUp())) pauseUntilNetworkReturns(jobId);
      },
      async failedRequestHandler({ request, addRequests }) {
        const data = request.userData as MapsRequestData;
        const error = request.errorMessages.at(-1) ?? "Crawlee request failed";
        if (data.kind === "detail") {
          updateMapsLead(jobId, data.leadId, {
            detailStatus: "failed",
            detailError: error,
          });
          logger.warn({ jobId, leadId: data.leadId, err: error }, "Maps Crawlee: detail failed");
          return;
        }
        // Job paused (by the user or because we went offline): the cell runs again on resume,
        // without using up its retry, since Google never answered it.
        if (!signal.aborted && !(await networkIsUp())) pauseUntilNetworkReturns(jobId);
        if (signal.aborted) {
          updateCell(jobId, data.cellIndex, { status: "pending", error });
          return;
        }
        // Google refused the cell (no feed, blocked session): it gets one more try at the end of
        // the queue, after the other cells. A second failure is final and shows on the job.
        if (!retriedCells.has(data.cellIndex) && !signal.aborted) {
          retriedCells.add(data.cellIndex);
          updateCell(jobId, data.cellIndex, { status: "pending", error });
          logger.warn({ jobId, cellIndex: data.cellIndex, err: error }, "Maps Crawlee: cell failed, retrying once at the end of the queue");
          await addRequests([{ ...cellRequest(data.cellIndex), uniqueKey: `cell:${jobId}:${data.cellIndex}:retry` }]);
        } else {
          updateCell(jobId, data.cellIndex, { status: "failed", error });
          logger.warn({ jobId, cellIndex: data.cellIndex, err: error }, "Maps Crawlee: cell failed");
        }
        const nextCell = takeNextCellRequest();
        if (nextCell && !signal.aborted) await addRequests([nextCell], { forefront: true });
      },
    },
    storageConfig,
  );

  const abortCrawler = () => {
    void crawler.autoscaledPool?.abort();
  };
  signal.addEventListener("abort", abortCrawler, { once: true });

  // Scan cells PARALLEL_CELLS at a time; each finished cell queues the next one.
  // Most leads now come complete from the search itself, so pages go to cells, not details.
  const PARALLEL_CELLS = MAPS_CONCURRENCY;
  let crawlerFinished = false;
  const expansionCellsReady: Promise<void> = learnNow
    ? learnJobExpansions(jobId, config, cells, signal)
        .then(async (expansions) => {
          if (!expansions.length || signal.aborted) return;
          const before = cells.length;
          addExpansionCells(jobId, cells, expansions);
          for (let index = before; index < cells.length; index++) pendingCellIndexes.push(index);
          if (crawlerFinished) return; // the run below picks them up
          const revived = [];
          for (; idleChains > 0 && revived.length < PARALLEL_CELLS; idleChains--) {
            const next = takeNextCellRequest();
            if (!next) break;
            revived.push(next);
          }
          if (revived.length) await crawler.addRequests(revived, { forefront: true });
        })
        .catch((err) => {
          logger.warn({ jobId, err: err instanceof Error ? err.message : String(err) }, "Search expansions not queued");
        })
    : Promise.resolve();

  let crashMessage: string | null = null;
  try {
    const initialRequests = [];
    for (let n = 0; n < PARALLEL_CELLS; n++) {
      const cell = takeNextCellRequest();
      if (cell) initialRequests.push(cell);
    }
    if (needsDetails) {
      for (const lead of job.results) {
        if (!lead.mapsUrl || lead.detailStatus === "done") continue;
        queuedDetailIds.add(lead.id);
        updateMapsLead(jobId, lead.id, { detailStatus: "running", detailError: null });
        initialRequests.push(detailRequest(lead));
      }
    }
    if (initialRequests.length > 0) {
      await crawler.run(initialRequests);
    }
  } catch (err) {
    crashMessage = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err: crashMessage }, "Maps Crawlee run crashed");
  } finally {
    crawlerFinished = true;
    // The quick pass is not over until the expansion cells exist.
    await expansionCellsReady;
    signal.removeEventListener("abort", abortCrawler);
    clearAbortSignal(jobId);
  }

  // The run ended before the probes did (small jobs), or the cells they queued came too late
  // for it: search them in a new run, without probing again.
  if (!crashMessage && !signal.aborted && learnNow &&
      cells.some((c) => c.autoTerm && (c.status === "pending" || c.status === "running"))) {
    expansionsAlreadyLearned.add(jobId);
    return runMapsJob(jobId);
  }

  // Crawlee can stop a whole run on an internal error (seen: "Promise handler has been canceled
  // due to a timeout" after one slow cell), leaving cells pending or half-done. The places
  // found so far are kept; a fresh run picks up every cell not finished yet (running cells
  // included), so nothing is lost. Gives up only when restarts stop making progress.
  if (crashMessage && !signal.aborted) {
    const doneNow = cellsFinished(jobId);
    const previous = crashRestarts.get(jobId);
    const attempts = previous && previous.doneCells === doneNow ? previous.attempts + 1 : 1;
    if (attempts <= MAX_CRASH_RESTARTS) {
      crashRestarts.set(jobId, { doneCells: doneNow, attempts });
      logger.warn({ jobId, attempts, doneCells: doneNow }, "Maps: restarting the run on the cells left");
      return runMapsJob(jobId);
    }
    crashRestarts.delete(jobId);
    updateMapsJob(jobId, { status: "failed", error: crashMessage });
    return;
  }
  crashRestarts.delete(jobId);

  const finalJob = getMapsJob(jobId);
  if (!finalJob) return;

  if (finalJob.status === "paused" || finalJob.status === "failed") return;

  // Quick pass done (every grid cell searched once): cut the cells that were full, then run
  // again on their quarters. The places found so far stay as they are; quarters only add.
  if (!refining && !signal.aborted) {
    const deferred = cells.flatMap((c, index) => (c.splitDeferred ? [index] : []));
    let quarters = 0;
    for (const index of deferred) {
      cells[index].splitDeferred = undefined;
      for (const q of splitSaturatedCell(jobId, cells, index, quarterOnArea)) {
        cells[q].refinement = true;
        quarters++;
      }
    }
    if (deferred.length) {
      updateMapsJob(jobId, { cells, totalCells: cells.filter((c) => c.status !== "skipped").length });
      logger.info(
        {
          jobId,
          quickPassMinutes: Number(((Date.now() - new Date(finalJob.createdAt).getTime()) / 60_000).toFixed(1)),
          leads: finalJob.totalLeads,
          fullCells: deferred.length,
          quarters,
        },
        "Maps: quick pass done, refining the full cells",
      );
    }
    if (quarters > 0) return runMapsJob(jobId);
  }

  const allDone = finalJob.cells.every(
    (c) => c.status !== "pending" && c.status !== "running",
  );
  updateMapsJob(jobId, { status: allDone ? "done" : "paused" });
  const failedCells = finalJob.cells.filter((c) => c.status === "failed").length;
  if (failedCells) logger.warn({ jobId, failedCells }, "Maps job finished with cells Google refused");
  logger.info({ jobId, totalLeads: finalJob.totalLeads }, "Maps job complete");
}
