import { randomUUID } from "crypto";
import { db, mapsJobs } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";
import type { GridCell, MapsScope } from "./geoGrid.js";
import type { MapsField, MapsLead } from "./googleMapsCrawler.js";

export type MapsJobStatus = "pending" | "running" | "paused" | "done" | "failed";

export interface MapsJobConfig {
  searchTerm: string;
  scope: MapsScope;
  location: string;
  selectedFields: MapsField[];
  label?: string;
}

export interface MapsJob {
  jobId: string;
  config: MapsJobConfig;
  cells: GridCell[];
  results: MapsLead[];
  status: MapsJobStatus;
  totalCells: number;
  completedCells: number;
  totalLeads: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const store = new Map<string, MapsJob>();
const pauseSignals = new Map<string, AbortController>();
const interruptedJobIds: string[] = [];

// Each update rewrites the whole job row (all leads), so coalesce bursts of updates
// into one write per job every PERSIST_DEBOUNCE_MS, and never run two writes for the
// same job at once (an older write must not land after a newer one).
const PERSIST_DEBOUNCE_MS = 2000;
const persistTimers = new Map<string, NodeJS.Timeout>();
const persistChains = new Map<string, Promise<void>>();
const PERSIST_RETRY_MS = 30_000;
const PERSIST_MAX_RETRIES = 60; // 30 minutes of outage
const persistFailures = new Map<string, number>();

function schedulePersist(jobId: string): void {
  if (persistTimers.has(jobId)) return;
  persistTimers.set(
    jobId,
    setTimeout(() => {
      persistTimers.delete(jobId);
      const job = store.get(jobId);
      if (!job) return;
      const next = (persistChains.get(jobId) ?? Promise.resolve()).then(() => persistJob(job));
      persistChains.set(jobId, next);
      void next.finally(() => {
        if (persistChains.get(jobId) === next) persistChains.delete(jobId);
      });
    }, PERSIST_DEBOUNCE_MS),
  );
}

/** Writes every pending debounced update now; call before the process exits. */
export async function flushMapsStore(): Promise<void> {
  const pending = [...persistTimers.keys()];
  for (const jobId of pending) {
    clearTimeout(persistTimers.get(jobId));
    persistTimers.delete(jobId);
    const job = store.get(jobId);
    if (!job) continue;
    persistChains.set(
      jobId,
      (persistChains.get(jobId) ?? Promise.resolve()).then(() => persistJob(job)),
    );
  }
  await Promise.all(persistChains.values());
}

/** Jobs that were running when the server last stopped; resumed automatically at startup. */
export function takeInterruptedJobIds(): string[] {
  return interruptedJobIds.splice(0);
}

async function persistJob(job: MapsJob): Promise<void> {
  // A write queued before a delete must not bring the job back.
  if (!store.has(job.jobId)) return;
  try {
    await db
      .insert(mapsJobs)
      .values({
        jobId: job.jobId,
        searchTerm: job.config.searchTerm,
        scope: job.config.scope,
        location: job.config.location,
        selectedFields: job.config.selectedFields as unknown as Record<string, unknown>,
        cells: job.cells as unknown as Record<string, unknown>,
        results: job.results as unknown as Record<string, unknown>,
        status: job.status,
        totalCells: job.totalCells,
        completedCells: job.completedCells,
        totalLeads: job.totalLeads,
        error: job.error,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
      })
      .onConflictDoUpdate({
        target: mapsJobs.jobId,
        set: {
          cells: job.cells as unknown as Record<string, unknown>,
          results: job.results as unknown as Record<string, unknown>,
          status: job.status,
          // Grows during the job (category terms, split cells): stale after a restart otherwise.
          totalCells: job.totalCells,
          completedCells: job.completedCells,
          totalLeads: job.totalLeads,
          error: job.error,
          updatedAt: new Date(job.updatedAt),
        },
      });
    persistFailures.delete(job.jobId);
  } catch (err) {
    // A network drop (DNS down, Neon unreachable) must not leave the stored job stale:
    // write the latest state again later, without logging the whole row each time.
    const failures = (persistFailures.get(job.jobId) ?? 0) + 1;
    persistFailures.set(job.jobId, failures);
    const cause = err instanceof Error ? String((err as { cause?: unknown }).cause ?? err.message).slice(0, 200) : String(err);
    logger.error({ jobId: job.jobId, failures, cause }, "Failed to persist maps job, retrying in 30s");
    if (failures <= PERSIST_MAX_RETRIES && store.has(job.jobId)) {
      setTimeout(() => schedulePersist(job.jobId), PERSIST_RETRY_MS);
    }
  }
}

export async function initMapsStore(): Promise<void> {
  try {
    const rows = await db.select().from(mapsJobs);
    for (const row of rows) {
      const cells = (row.cells as unknown as GridCell[]) ?? [];

      // Any cell stuck in "running" from a prior server instance should be reset
      // to "pending" so it gets retried when the job is resumed.
      const healedCells = cells.map((c) =>
        c.status === "running" ? { ...c, status: "pending" as const } : c,
      );

      // Any job that was "running" or "pending" when the server died is set to
      // "paused" and queued for automatic resume once the server is up.
      let status = row.status as MapsJobStatus;
      const error = row.error;
      if (status === "running" || status === "pending") {
        status = "paused";
        interruptedJobIds.push(row.jobId);
      }

      const completedCells = healedCells.filter(
        (c) => c.status === "done" || c.status === "failed",
      ).length;
      const totalCells = healedCells.filter((c) => c.status !== "skipped").length;

      // A lead whose details were loading when the server stopped is marked partial. Results of
      // the former "Enrich" button (removed: qualifying is done in the Lead Qualifier) are dropped.
      const rawResults = (row.results as unknown as (MapsLead & Record<string, unknown>)[]) ?? [];
      const hadEnrichData = rawResults.some((lead) => "enrichStatus" in lead || "enrichResult" in lead);
      const healedResults: MapsLead[] = rawResults.map(
        ({ enrichStatus: _s, enrichResult: _r, enrichError: _e, ...lead }) => ({
          ...lead,
          ...(lead.detailStatus === "running" ? {
            detailStatus: "failed" as const,
            detailError: "Server restarted during detail extraction. Retry the search to continue.",
          } : {}),
        }),
      );
      const resultsChanged = hadEnrichData || healedResults.some(
        (lead, index) => lead.detailStatus !== rawResults[index]?.detailStatus,
      );

      const job: MapsJob = {
        jobId: row.jobId,
        config: {
          searchTerm: row.searchTerm,
          scope: row.scope as MapsScope,
          location: row.location ?? "",
          selectedFields: (row.selectedFields as unknown as MapsField[]) ?? [],
        },
        cells: healedCells,
        results: healedResults,
        status,
        // From the cells, like completedCells: older versions saved the first grid's size and
        // missed the cells added later (split cells, Google categories), showing "48/20".
        totalCells,
        completedCells,
        totalLeads: row.totalLeads,
        error,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      store.set(row.jobId, job);

      // Persist the healed state back to DB if we changed anything
      if (status !== row.status || completedCells !== row.completedCells || totalCells !== row.totalCells || resultsChanged) {
        void persistJob(job);
      }
    }
    logger.info({ count: rows.length }, "Maps jobs loaded from database");
  } catch (err) {
    // Starting with no searches would look like lost data: the startup retries instead.
    store.clear();
    interruptedJobIds.length = 0;
    throw err;
  }
}

export function createMapsJob(config: MapsJobConfig, cells: GridCell[]): MapsJob {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: MapsJob = {
    jobId,
    config,
    cells,
    results: [],
    status: "pending",
    totalCells: cells.filter((c) => c.status !== "skipped").length,
    completedCells: 0,
    totalLeads: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  store.set(jobId, job);
  void persistJob(job);
  return job;
}

/**
 * Deletes a search that is not running (finished, paused or failed), from memory and the database.
 * Returns "running" when it is still at work: pause it first.
 */
export async function deleteMapsJob(jobId: string): Promise<"deleted" | "not-found" | "running"> {
  const job = store.get(jobId);
  if (!job) return "not-found";
  if (job.status === "running" || job.status === "pending") return "running";
  store.delete(jobId);
  clearTimeout(persistTimers.get(jobId));
  persistTimers.delete(jobId);
  persistFailures.delete(jobId);
  await (persistChains.get(jobId) ?? Promise.resolve());
  try {
    await db.delete(mapsJobs).where(eq(mapsJobs.jobId, jobId));
  } catch (err) {
    // Not deleted in the database: keep it listed rather than have it come back at the next start.
    store.set(jobId, job);
    throw err;
  }
  return "deleted";
}

export function getMapsJob(jobId: string): MapsJob | undefined {
  return store.get(jobId);
}

export function listMapsJobs(): MapsJob[] {
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function updateMapsJob(jobId: string, updates: Partial<MapsJob>): void {
  const job = store.get(jobId);
  if (!job) return;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  schedulePersist(jobId);
}

export function addMapsLeads(
  jobId: string,
  newLeads: MapsLead[],
  source?: { term: string; cellIndex: number },
): string[] {
  const job = store.get(jobId);
  if (!job) return [];

  // Deduplicate by id — prefer mapsUrl-derived IDs; fall back to name+address
  const existingIds = new Set(job.results.map((r) => r.id));
  const deduped = newLeads
    .filter((l) => l.id && !existingIds.has(l.id))
    .map((l) => (source ? { ...l, foundBy: source.term, foundInCell: source.cellIndex } : l));
  job.results.push(...deduped);
  job.totalLeads = job.results.length;
  job.updatedAt = new Date().toISOString();
  schedulePersist(jobId);
  return deduped.map((lead) => lead.id);
}

export interface TermYield {
  term: string;
  /** Learned from Google's categories, not typed or translated. */
  auto: boolean;
  minutes: number;
  /** Places this term's cells found first. */
  places: number;
  /** Of those, places the list shows (not hidden as unrelated). */
  shown: number;
}

/**
 * What each search term cost and brought. A term with many minutes and few shown places is
 * not worth searching. Places found before Nov 2026 have no term: they are not counted.
 */
export function termYield(job: MapsJob, isShown: (lead: MapsLead) => boolean): TermYield[] {
  const terms = new Map<string, TermYield>();
  const entry = (term: string) => {
    let t = terms.get(term);
    if (!t) terms.set(term, (t = { term, auto: false, minutes: 0, places: 0, shown: 0 }));
    return t;
  };
  for (const c of job.cells) {
    const t = entry(c.searchTerm || job.config.searchTerm);
    t.minutes += (c.durationMs ?? 0) / 60_000;
    if (c.autoTerm) t.auto = true;
  }
  for (const lead of job.results) {
    if (!lead.foundBy) continue;
    const t = entry(lead.foundBy);
    t.places++;
    if (isShown(lead)) t.shown++;
  }
  return [...terms.values()]
    .map((t) => ({ ...t, minutes: Math.round(t.minutes * 10) / 10 }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function updateCell(jobId: string, cellIndex: number, updates: Partial<GridCell>): void {
  const job = store.get(jobId);
  if (!job) return;
  const cell = job.cells[cellIndex];
  if (!cell) return;
  Object.assign(cell, updates);
  if (
    updates.status === "done" ||
    updates.status === "failed" ||
    updates.status === "skipped"
  ) {
    job.completedCells = job.cells.filter(
      (c) => c.status === "done" || c.status === "failed",
    ).length;
  }
  job.updatedAt = new Date().toISOString();
  schedulePersist(jobId);
}

export function pauseMapsJob(jobId: string): boolean {
  const job = store.get(jobId);
  if (!job || job.status !== "running") return false;
  const ctrl = pauseSignals.get(jobId);
  if (ctrl) ctrl.abort();
  updateMapsJob(jobId, { status: "paused" });
  return true;
}

export function getAbortSignal(jobId: string): AbortSignal {
  const ctrl = new AbortController();
  pauseSignals.set(jobId, ctrl);
  return ctrl.signal;
}

export function clearAbortSignal(jobId: string): void {
  pauseSignals.delete(jobId);
}

export function isJobPausedOrDone(jobId: string): boolean {
  const job = store.get(jobId);
  if (!job) return true;
  return job.status === "paused" || job.status === "done" || job.status === "failed";
}

/** Every term the job searches: the first term and each cell's term (expansions included). */
export function jobSearchTerms(jobId: string): string[] {
  const job = store.get(jobId);
  if (!job) return [];
  return [...new Set([job.config.searchTerm, ...job.cells.map((c) => c.searchTerm ?? "")].filter(Boolean))];
}

export function updateMapsLead(jobId: string, leadId: string, updates: Partial<MapsLead>): void {
  const job = store.get(jobId);
  if (!job) return;
  const index = job.results.findIndex((r) => r.id === leadId);
  if (index === -1) return;
  Object.assign(job.results[index], updates);
  job.updatedAt = new Date().toISOString();
  schedulePersist(jobId);
}
