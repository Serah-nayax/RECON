import { randomUUID } from "crypto";
import { db, mapsJobs } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
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

async function persistJob(job: MapsJob): Promise<void> {
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
          completedCells: job.completedCells,
          totalLeads: job.totalLeads,
          error: job.error,
          updatedAt: new Date(job.updatedAt),
        },
      });
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, "Failed to persist maps job");
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

      // Any job that was "running" or "pending" when the server died should be
      // set to "paused" so users can see it and resume manually.
      let status = row.status as MapsJobStatus;
      let error = row.error;
      if (status === "running" || status === "pending") {
        status = "paused";
        error = error ?? "Server restarted mid-job. Resume to continue.";
      }

      const completedCells = healedCells.filter(
        (c) => c.status === "done" || c.status === "failed",
      ).length;

      // Any lead stuck in "running" from a prior server instance should be reset
      // to "idle" so it can be re-enriched instead of being stuck forever.
      const rawResults = (row.results as unknown as MapsLead[]) ?? [];
      const healedResults = rawResults.map((lead) => ({
        ...lead,
        ...(lead.detailStatus === "running" ? {
          detailStatus: "failed" as const,
          detailError: "Server restarted during detail extraction. Retry the search to continue.",
        } : {}),
        ...(lead.enrichStatus === "running" ? { enrichStatus: "idle" as const } : {}),
      }));
      const resultsChanged = healedResults.some(
        (lead, index) =>
          lead.enrichStatus !== rawResults[index]?.enrichStatus ||
          lead.detailStatus !== rawResults[index]?.detailStatus,
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
        totalCells: row.totalCells,
        completedCells,
        totalLeads: row.totalLeads,
        error,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      store.set(row.jobId, job);

      // Persist the healed state back to DB if we changed anything
      if (status !== row.status || completedCells !== row.completedCells || resultsChanged) {
        void persistJob(job);
      }
    }
    logger.info({ count: rows.length }, "Maps jobs loaded from database");
  } catch (err) {
    logger.error({ err }, "Failed to load maps jobs from DB");
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
  void persistJob(job);
}

export function addMapsLeads(jobId: string, newLeads: MapsLead[]): string[] {
  const job = store.get(jobId);
  if (!job) return [];

  // Deduplicate by id — prefer mapsUrl-derived IDs; fall back to name+address
  const existingIds = new Set(job.results.map((r) => r.id));
  const deduped = newLeads.filter((l) => l.id && !existingIds.has(l.id));
  job.results.push(...deduped);
  job.totalLeads = job.results.length;
  job.updatedAt = new Date().toISOString();
  void persistJob(job);
  return deduped.map((lead) => lead.id);
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
  void persistJob(job);
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

export function updateMapsLead(jobId: string, leadId: string, updates: Partial<MapsLead>): void {
  const job = store.get(jobId);
  if (!job) return;
  const lead = job.results.find((r) => r.id === leadId);
  if (!lead) return;
  Object.assign(lead, updates);
  job.updatedAt = new Date().toISOString();
  void persistJob(job);
}
