import { Router, type IRouter } from "express";
import {
  PlaywrightCrawler,
  Configuration,
  type PlaywrightLaunchContext,
} from "@crawlee/playwright";
import { MemoryStorage } from "@crawlee/memory-storage";
import { chromium } from "playwright";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import {
  createMapsJob,
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
} from "../lib/mapsStore.js";
import { generateGrid, generateSmartGrid, generateGridFromBbox, VALID_SCOPES } from "../lib/geoGrid.js";
import {
  scrapeGoogleMapsCell,
  scrapeGoogleMapsDetailPage,
  buildGoogleMapsSearchUrl,
  ALL_FIELDS,
  DETAIL_FIELDS,
} from "../lib/googleMapsCrawler.js";
import { logger } from "../lib/logger.js";
import { qualifyLead } from "../lib/qualifyLead.js";
import { getIcp } from "../lib/icpStore.js";
import { createBatch } from "../lib/qualifyStore.js";
import { runQualifyBatch } from "../lib/qualifyRunner.js";
import { translateTermsForArea } from "../lib/translateTerms.js";
import type { MapsField, MapsLead } from "../lib/googleMapsCrawler.js";
import type { MapsScope } from "../lib/geoGrid.js";

const router: IRouter = Router();
const activeMapRuns = new Map<string, Promise<void>>();
let mapsRunTail: Promise<void> = Promise.resolve();

function startMapsJob(jobId: string): void {
  // One Crawlee Maps job at a time keeps the process-wide browser-page ceiling
  // at maxConcurrency rather than multiplying it across simultaneous jobs.
  const run = mapsRunTail
    .catch(() => { /* a prior run already recorded its failure */ })
    .then(() => runMapsJob(jobId))
    .finally(() => {
      if (activeMapRuns.get(jobId) === run) activeMapRuns.delete(jobId);
    });
  mapsRunTail = run.catch(() => { /* runMapsJob records failures in the job */ });
  activeMapRuns.set(jobId, run);
}

router.use(apiKeyMiddleware);

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

  // Accept areas[] (new) or legacy area string
  let areas: string[] = [];
  if (Array.isArray(body.areas) && body.areas.length > 0) {
    areas = (body.areas as unknown[]).map(String).map((s) => s.trim()).filter(Boolean);
  } else {
    const legacy = String(body.area ?? body.location ?? "").trim();
    if (legacy) areas = [legacy];
  }

  const rawBbox = body.bbox as Record<string, unknown> | undefined;
  const hasBbox = rawBbox && typeof rawBbox === "object" &&
    ["minLat", "maxLat", "minLng", "maxLng"].every((k) => k in rawBbox!);

  if (areas.length === 0 && !hasBbox) {
    res.status(400).json({ error: "area or bbox is required" });
    return;
  }

  // Build one cell grid per area (+ one for bbox if provided)
  type AreaGrid = { location: string; cells: Awaited<ReturnType<typeof generateSmartGrid>> };
  const areaGrids: AreaGrid[] = [];

  try {
    if (hasBbox) {
      const bbox = {
        minLat: Number(rawBbox!.minLat), maxLat: Number(rawBbox!.maxLat),
        minLng: Number(rawBbox!.minLng), maxLng: Number(rawBbox!.maxLng),
      };
      areaGrids.push({ location: label || "Custom area", cells: generateGridFromBbox(bbox, searchTerms[0]) });
    }
    for (const areaText of areas) {
      const cells = await generateSmartGrid(areaText, searchTerms[0]);
      areaGrids.push({ location: areaText, cells });
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

  const MAX_CELLS = 300;

  // Translate search terms to the local language for each area (runs in parallel).
  // Falls back to original terms for English-speaking areas or on failure.
  const areaLocalTerms = await Promise.all(
    areaGrids.map(async ({ location: loc }) => ({
      loc,
      terms: await translateTermsForArea(searchTerms, loc),
    })),
  );
  const localTermsMap = new Map(areaLocalTerms.map(({ loc, terms }) => [loc, terms]));

  // One combined job — flatten all (area × term) cells into a single cell list.
  // Each cell carries its own searchTerm override (localised) so the scraper uses the right query.
  const allCells = areaGrids.flatMap(({ location: loc, cells }) => {
    const localTerms = localTermsMap.get(loc) ?? searchTerms;
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
  const combinedLocation = areas.join(", ") || (label ?? "Custom area");

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
      cells = await generateSmartGrid(area, "preview");
    }
    res.json({ cells, count: cells.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

router.get("/maps", (_req, res) => {
  const jobs = listMapsJobs().map(({ results: _r, cells: _c, ...rest }) => rest);
  res.json({ jobs });
});

router.get("/maps/:jobId", (req, res) => {
  const job = getMapsJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }
  res.json(job);
});

/**
 * Long-held request the dashboard keeps open while a job has background work.
 * Autoscale deployments only get full CPU while a request is in flight, so
 * without this the headless browser is starved between short polls.
 */
const KEEPALIVE_MAX_MS = 25_000;
function jobHasActiveWork(jobId: string): boolean {
  const job = getMapsJob(jobId);
  if (!job) return false;
  if (job.status === "running" || job.status === "pending") return true;
  return job.results.some(
    (r) => r.enrichStatus === "running" || r.detailStatus === "running",
  );
}

router.get("/maps/:jobId/keepalive", async (req, res) => {
  const { jobId } = req.params;
  if (!getMapsJob(jobId)) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }
  const started = Date.now();
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  while (!closed && Date.now() - started < KEEPALIVE_MAX_MS && jobHasActiveWork(jobId)) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (closed) return;
  res.json({ active: jobHasActiveWork(jobId), status: getMapsJob(jobId)?.status ?? null });
});

router.post("/maps/:jobId/pause", (req, res) => {
  const ok = pauseMapsJob(req.params.jobId);
  if (!ok) {
    res.status(400).json({ error: "Job not found or not running" });
    return;
  }
  res.json({ ok: true });
});

router.post("/maps/:jobId/enrich/:leadId", async (req, res) => {
  const { jobId, leadId } = req.params;
  const job = getMapsJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }
  const lead = job.results.find((r) => r.id === leadId);
  if (!lead) {
    res.status(404).json({ error: "Lead not found in job" });
    return;
  }
  if (!lead.website) {
    res.status(400).json({ error: "Lead has no website URL to enrich" });
    return;
  }
  if (lead.enrichStatus === "running") {
    res.status(409).json({ error: "Enrichment already in progress for this lead" });
    return;
  }

  updateMapsLead(jobId, leadId, { enrichStatus: "running", enrichError: null });

  setImmediate(async () => {
    try {
      const icp = getIcp();
      const result = await qualifyLead(
        {
          name: lead.name,
          url: lead.website!,
          category: lead.category,
          city: lead.address,
        },
        icp,
      );
      updateMapsLead(jobId, leadId, {
        enrichStatus: "done",
        enrichResult: result,
        enrichError: null,
      });
      logger.info({ jobId, leadId, score: result.score }, "Lead enriched successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId, leadId, err: message }, "Lead enrichment failed");
      updateMapsLead(jobId, leadId, { enrichStatus: "failed", enrichError: message });
    }
  });

  res.status(202).json({ ok: true, leadId, message: "Enrichment started" });
});

router.post("/maps/:jobId/enrich-all", async (req, res) => {
  const { jobId } = req.params;
  const job = getMapsJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }

  const eligibleLeads = job.results.filter(
    (lead) =>
      lead.website &&
      (!lead.enrichStatus || lead.enrichStatus === "idle" || lead.enrichStatus === "failed"),
  );

  if (eligibleLeads.length === 0) {
    res.status(409).json({ error: "No leads eligible for enrichment (all already enriched or running)" });
    return;
  }

  res.status(202).json({
    ok: true,
    count: eligibleLeads.length,
    message: `Enriching ${eligibleLeads.length} lead(s) sequentially`,
  });

  setImmediate(async () => {
    for (const lead of eligibleLeads) {
      updateMapsLead(jobId, lead.id, { enrichStatus: "running", enrichError: null });
      try {
        const icp = getIcp();
        const result = await qualifyLead(
          {
            name: lead.name,
            url: lead.website!,
            category: lead.category,
            city: lead.address,
          },
          icp,
        );
        updateMapsLead(jobId, lead.id, {
          enrichStatus: "done",
          enrichResult: result,
          enrichError: null,
        });
        logger.info({ jobId, leadId: lead.id, score: result.score }, "Lead enriched successfully (bulk)");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ jobId, leadId: lead.id, err: message }, "Lead enrichment failed (bulk)");
        updateMapsLead(jobId, lead.id, { enrichStatus: "failed", enrichError: message });
      }
    }
    logger.info({ jobId, count: eligibleLeads.length }, "Bulk enrichment complete");
  });
});

router.post("/maps/:jobId/qualify-all", (req, res) => {
  const { jobId } = req.params;
  const job = getMapsJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Maps job not found" });
    return;
  }

  const eligibleLeads = job.results.filter((lead) => lead.website && lead.name);

  if (eligibleLeads.length === 0) {
    res.status(409).json({ error: "No leads with websites to qualify" });
    return;
  }

  const icp = getIcp();
  const leads = eligibleLeads.map((lead) => ({
    name: lead.name,
    url: lead.website!,
    category: lead.category,
    city: lead.address,
  }));

  const batch = createBatch(leads, icp.name);

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

async function runMapsJob(jobId: string): Promise<void> {
  const job = getMapsJob(jobId);
  if (!job) return;

  updateMapsJob(jobId, { status: "running" });

  const signal = getAbortSignal(jobId);
  const { config, cells } = job;
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
    .filter(({ cell }) => cell.status === "pending")
    .map(({ index }) => index);
  let nextCellCursor = 0;
  const queuedDetailIds = new Set<string>();

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

  const takeNextCellRequest = () => {
    const cellIndex = pendingCellIndexes[nextCellCursor++];
    return cellIndex == null ? null : cellRequest(cellIndex);
  };

  let crawler: PlaywrightCrawler;
  crawler = new PlaywrightCrawler(
    {
      launchContext: buildCrawleeLaunchContext(),
      maxConcurrency: 2,
      minConcurrency: 1,
      maxRequestRetries: 2,
      maxSessionRotations: 3,
      retryOnBlocked: true,
      navigationTimeoutSecs: 35,
      requestHandlerTimeoutSecs: 75,
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
        maxOpenPagesPerBrowser: 2,
        retireBrowserAfterPageCount: 12,
      },
      preNavigationHooks: [
        async ({ page, request }, gotoOptions) => {
          const data = request.userData as MapsRequestData;
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
            if (["image", "font", "media"].includes(resourceType) || isTelemetry) {
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
        if (!cell || cell.status !== "pending") return;
        updateCell(jobId, i, { status: "running", error: undefined });

        const discoveredIds = new Set<string>();
        const filterInBounds = (candidateLeads: MapsLead[]) => {
          const half = cell.halfDeg ?? 0;
          return half > 0
            ? candidateLeads.filter((lead) => {
                if (lead.lat == null || lead.lng == null) return true;
                return (
                  lead.lat >= cell.lat - half && lead.lat <= cell.lat + half &&
                  lead.lng >= cell.lng - half && lead.lng <= cell.lng + half
                );
              })
            : candidateLeads;
        };

        const leads = await scrapeGoogleMapsCell(
          cell.searchTerm || config.searchTerm,
          config.scope,
          config.location,
          cell,
          config.selectedFields,
          page,
          signal,
          (partialLeads) => {
            const partialIds = addMapsLeads(jobId, filterInBounds(partialLeads));
            for (const id of partialIds) discoveredIds.add(id);
          },
          true,
        );

        if (signal.aborted || isJobPausedOrDone(jobId)) {
          updateCell(jobId, i, { status: "pending" });
          return;
        }
        if (leads.length === 0) {
          session?.markBad();
          throw new Error("Google Maps returned no visible business feed; retrying with a fresh Crawlee session");
        }

        const inBounds = filterInBounds(leads);
        const insertedIds = addMapsLeads(jobId, inBounds);
        for (const id of insertedIds) discoveredIds.add(id);
        updateCell(jobId, i, { status: "done", leadsFound: inBounds.length });
        logger.info({ jobId, cellIndex: i, leadsFound: inBounds.length }, "Maps Crawlee: cell scraped");

        if (needsDetails) {
          const detailLeads = inBounds.filter(
            (lead) => discoveredIds.has(lead.id) && lead.mapsUrl && !queuedDetailIds.has(lead.id),
          );
          for (const lead of detailLeads) {
            queuedDetailIds.add(lead.id);
            updateMapsLead(jobId, lead.id, { detailStatus: "running", detailError: null });
          }
          if (detailLeads.length > 0) {
            await addRequests(
              detailLeads.map((lead) => detailRequest(lead, i)),
              { forefront: true },
            );
          }
        }

        const nextCell = takeNextCellRequest();
        if (nextCell) await addRequests([nextCell]);
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
        updateCell(jobId, data.cellIndex, { status: "failed", error });
        logger.warn({ jobId, cellIndex: data.cellIndex, err: error }, "Maps Crawlee: cell failed");
        const nextCell = takeNextCellRequest();
        if (nextCell && !signal.aborted) await addRequests([nextCell]);
      },
    },
    storageConfig,
  );

  const abortCrawler = () => {
    void crawler.autoscaledPool?.abort();
  };
  signal.addEventListener("abort", abortCrawler, { once: true });

  try {
    const initialRequests = [];
    if (needsDetails) {
      for (const lead of job.results) {
        if (!lead.mapsUrl || lead.detailStatus === "done") continue;
        queuedDetailIds.add(lead.id);
        updateMapsLead(jobId, lead.id, { detailStatus: "running", detailError: null });
        initialRequests.push(detailRequest(lead));
      }
    }
    const firstCell = takeNextCellRequest();
    if (firstCell) initialRequests.push(firstCell);

    if (initialRequests.length > 0) {
      await crawler.run(initialRequests);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err: message }, "Maps Crawlee job failed");
    if (!signal.aborted) updateMapsJob(jobId, { status: "failed", error: message });
  } finally {
    signal.removeEventListener("abort", abortCrawler);
    clearAbortSignal(jobId);
  }

  const finalJob = getMapsJob(jobId);
  if (!finalJob) return;

  if (finalJob.status === "paused" || finalJob.status === "failed") return;

  const allDone = finalJob.cells.every(
    (c) => c.status !== "pending" && c.status !== "running",
  );
  updateMapsJob(jobId, { status: allDone ? "done" : "paused" });
  logger.info({ jobId, totalLeads: finalJob.totalLeads }, "Maps job complete");
}

export default router;
