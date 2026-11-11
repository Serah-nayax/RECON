import { randomUUID } from "crypto";
import { db, qualifyBatches } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger.js";
import { loadRowsCached } from "../dbRowCache.js";
import type { AiUsage } from "./aiUsage.js";

// Review and competitor analyses: made by an earlier version of the qualifier.
// No longer produced (always null), kept so that older batches still display them.
export interface ReviewPlatformSummary {
  platform: string;
  url: string;
  rating: number | null;
  reviewCount: number | null;
}

export interface ReviewInsight {
  summary: string;
  quote: string | null;
}

export interface ReviewAspect {
  name: string;
  score: number;
  quote: string | null;
}

export type ReviewSentiment = "Excellent" | "Good" | "Mixed" | "Concerning";

export interface ReviewAnalysis {
  sentiment: ReviewSentiment;
  platformSummaries: ReviewPlatformSummary[];
  strengths: ReviewInsight[];
  weaknesses: ReviewInsight[];
  aspects: ReviewAspect[];
}

export interface CompetitorAspect {
  aspect: string;
  them: string;
  us: string;
}

export interface CompetitorSocialSummary {
  platform: string;
  url: string;
  bio?: string;
  followers?: string;
  postTone?: string;
  categoryTags?: string[];
}

export interface CompetitorAnalysis {
  vendorName: string;
  productCategory: string | null;
  description: string | null;
  comparisonTable: CompetitorAspect[];
  socialIntel: CompetitorSocialSummary[];
  strategicOverview: string;
  competitiveAngle: string;
}

export type LeadStatus = "pending" | "crawling" | "scoring" | "done" | "failed";
/** "cancelled": stopped by the user. Its unscored leads are "failed" with CANCELLED_ERROR. */
export type BatchStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export const CANCELLED_ERROR = "Qualification cancelled";

function isCancelledLead(lead: LeadResult): boolean {
  return lead.status === "failed" && lead.error === CANCELLED_ERROR;
}

/** Leads really processed: scored or failed, not the ones left unscored by a stop. */
function processedCount(leads: LeadResult[]): number {
  return leads.filter((l) => (l.status === "done" || l.status === "failed") && !isCancelledLead(l)).length;
}

export interface LeadInput {
  name: string;
  url: string;
  category?: string;
  city?: string;
  country?: string;
  notes?: string;
}

export interface SourceSummary {
  pages: number;
  reviews: { platform: string; url: string }[];
  socials: { platform: string; url: string }[];
}

export interface VenueIntel {
  estimatedMachineCount: string;
  paymentSystem: string;
  venueType: string;
  hasRedemption: boolean;
  hasLoyalty: boolean;
  hasFoodBeverage: boolean;
  hasPartyRooms: boolean;
  isChain: boolean;
  chainName: string | null;
}

export interface DecisionMaker {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

export interface SocialProfile {
  platform: string;
  url: string;
  bio?: string;
  category?: string;
  followers?: string;
  postTone?: string;
  categoryTags?: string[];
}

export interface OutreachIntel {
  pitchAngle: string;
  competitorSystem: string | null;
  decisionMakers: DecisionMaker[];
  openingHook: string | null;
}

export interface LeadResult {
  leadId: string;
  input: LeadInput;
  status: LeadStatus;
  score: number | null;
  verdict: "QUALIFY" | "BORDERLINE" | "DISQUALIFY" | null;
  icpExplanation: string | null;
  keySignals: string[];
  missingSignals: string[];
  painPoints: string[];
  venueIntel: VenueIntel | null;
  outreachIntel: OutreachIntel | null;
  recommendedAction: string | null;
  crawledPages: number;
  sourceSummary: SourceSummary | null;
  socialProfiles: SocialProfile[];
  reviewAnalysis: ReviewAnalysis | null;
  competitorAnalysis: CompetitorAnalysis | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** AI tokens used for this lead. Missing on leads qualified before tracking existed. */
  aiUsage?: AiUsage | null;
}

export interface QualifyBatch {
  batchId: string;
  status: BatchStatus;
  icpSnapshot: string;
  leads: LeadResult[];
  createdAt: string;
  updatedAt: string;
  completedCount: number;
  totalCount: number;
}

const store = new Map<string, QualifyBatch>();
const cancelledBatches = new Set<string>();
const cancellationListeners = new Map<string, Set<() => void>>();

export function onBatchCancelled(batchId: string, listener: () => void): () => void {
  if (cancelledBatches.has(batchId)) {
    listener();
    return () => {};
  }
  const listeners = cancellationListeners.get(batchId) ?? new Set<() => void>();
  listeners.add(listener);
  cancellationListeners.set(batchId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) cancellationListeners.delete(batchId);
  };
}

export function cancelBatch(batchId: string): boolean {
  const batch = store.get(batchId);
  if (!batch || (batch.status !== "pending" && batch.status !== "running")) return false;
  cancelledBatches.add(batchId);
  for (const listener of cancellationListeners.get(batchId) ?? []) listener();
  cancellationListeners.delete(batchId);
  const now = new Date().toISOString();
  batch.status = "cancelled";
  for (const lead of batch.leads) {
    if (lead.status !== "done" && lead.status !== "failed") {
      lead.status = "failed";
      lead.error = CANCELLED_ERROR;
      lead.completedAt = now;
    }
  }
  // "53 / 306 processed", not "306 / 306": the stopped leads were never scored.
  batch.completedCount = processedCount(batch.leads);
  batch.updatedAt = now;
  store.set(batchId, batch);
  void persistBatch(batch);
  return true;
}

export function isBatchCancelled(batchId: string): boolean {
  return cancelledBatches.has(batchId);
}

// Saving. A batch row holds every lead (a 250-lead batch is ~1 MB), so rewriting it on each
// update fell minutes behind on a slow network: a server killed mid-batch lost the leads finished
// since the last write, and paid their AI calls again on resume. Now a lead update sends only that
// lead (jsonb_set), and a finished lead is saved within FINISHED_LEAD_DELAY_MS. Whole-row writes
// remain for new, cancelled and batch-level updates. One write at a time per batch, in order.
const PROGRESS_DELAY_MS = 2000; // crawling / scoring status: not worth a write each
const FINISHED_LEAD_DELAY_MS = 300; // a result that cost an AI call
const PERSIST_RETRY_MS = 30_000;
const PERSIST_MAX_RETRIES = 60; // 30 minutes of outage
const MAX_LEADS_PER_PATCH = 50; // past this, one whole-row write is simpler

interface DirtyState {
  full: boolean;
  leads: Set<number>;
}
const dirty = new Map<string, DirtyState>();
const persistTimers = new Map<string, { timer: NodeJS.Timeout; due: number }>();
const persistChains = new Map<string, Promise<void>>();
const persistFailures = new Map<string, number>();

function markDirty(batchId: string, leadIndex?: number): void {
  const state = dirty.get(batchId) ?? { full: false, leads: new Set<number>() };
  if (leadIndex === undefined) state.full = true;
  else state.leads.add(leadIndex);
  dirty.set(batchId, state);
}

function queuePersist(batchId: string): void {
  const next = (persistChains.get(batchId) ?? Promise.resolve()).then(() => writeDirty(batchId));
  persistChains.set(batchId, next);
  void next.finally(() => {
    if (persistChains.get(batchId) === next) persistChains.delete(batchId);
  });
}

/** Writes the batch's pending changes within `delayMs` (sooner if already planned sooner). */
function schedulePersist(batchId: string, delayMs: number): void {
  const due = Date.now() + delayMs;
  const planned = persistTimers.get(batchId);
  if (planned && planned.due <= due) return;
  if (planned) clearTimeout(planned.timer);
  persistTimers.set(batchId, {
    due,
    timer: setTimeout(() => {
      persistTimers.delete(batchId);
      queuePersist(batchId);
    }, delayMs),
  });
}

/** Writes every pending update now; call before the process exits. */
export async function flushQualifyStore(): Promise<void> {
  for (const [batchId, planned] of persistTimers) {
    clearTimeout(planned.timer);
    persistTimers.delete(batchId);
  }
  for (const batchId of dirty.keys()) queuePersist(batchId);
  await Promise.all(persistChains.values());
}

async function writeDirty(batchId: string): Promise<void> {
  const batch = store.get(batchId);
  const state = dirty.get(batchId);
  if (!batch || !state) return;
  dirty.delete(batchId);
  try {
    const patched = !state.full && state.leads.size <= MAX_LEADS_PER_PATCH && (await patchLeads(batch, state.leads));
    if (!patched) await writeWholeBatch(batch);
    persistFailures.delete(batchId);
  } catch (err) {
    // Keep the changes and try again later: a network drop must not leave the saved batch stale.
    const pending = dirty.get(batchId);
    if (pending) {
      pending.full ||= state.full;
      for (const index of state.leads) pending.leads.add(index);
    } else {
      dirty.set(batchId, state);
    }
    const failures = (persistFailures.get(batchId) ?? 0) + 1;
    persistFailures.set(batchId, failures);
    const cause = err instanceof Error ? String((err as { cause?: unknown }).cause ?? err.message).slice(0, 200) : String(err);
    logger.error({ batchId, failures, cause }, "Failed to save qualify batch, retrying in 30s");
    if (failures <= PERSIST_MAX_RETRIES) schedulePersist(batchId, PERSIST_RETRY_MS);
  }
}

/** Sends only the changed leads. Returns false if the row is not in the database yet. */
async function patchLeads(batch: QualifyBatch, indexes: Set<number>): Promise<boolean> {
  let leads = sql`${sql.identifier("leads")}`;
  for (const index of indexes) {
    leads = sql`jsonb_set(${leads}, ${`{${index}}`}::text[], ${JSON.stringify(batch.leads[index])}::jsonb)`;
  }
  const updated = await db
    .update(qualifyBatches)
    .set({
      leads,
      status: batch.status,
      completedCount: batch.completedCount,
      updatedAt: new Date(batch.updatedAt),
    })
    .where(eq(qualifyBatches.batchId, batch.batchId))
    .returning({ batchId: qualifyBatches.batchId });
  return updated.length > 0;
}

/** Writes a batch now, in its own place in the batch's write order. */
function persistBatch(batch: QualifyBatch): void {
  markDirty(batch.batchId);
  queuePersist(batch.batchId);
}

async function writeWholeBatch(batch: QualifyBatch): Promise<void> {
  await db
    .insert(qualifyBatches)
    .values({
      batchId: batch.batchId,
      status: batch.status,
      icpSnapshot: batch.icpSnapshot,
      leads: batch.leads as unknown as Record<string, unknown>[],
      createdAt: new Date(batch.createdAt),
      updatedAt: new Date(batch.updatedAt),
      completedCount: batch.completedCount,
      totalCount: batch.totalCount,
    })
    .onConflictDoUpdate({
      target: qualifyBatches.batchId,
      set: {
        status: batch.status,
        leads: batch.leads as unknown as Record<string, unknown>[],
        updatedAt: new Date(batch.updatedAt),
        completedCount: batch.completedCount,
      },
    });
}

const interruptedBatchIds: string[] = [];

/** Batches that were running when the server last stopped; resumed at startup. */
export function takeInterruptedBatchIds(): string[] {
  return interruptedBatchIds.splice(0);
}

export async function initQualifyStore(): Promise<void> {
  try {
    const rows = await loadRowsCached<typeof qualifyBatches.$inferSelect>(
      qualifyBatches, "qualify_batches", qualifyBatches.batchId, "batchId", ["createdAt", "updatedAt"],
    );
    for (const row of rows) {
      const leads = row.leads as unknown as LeadResult[];
      // Batches stopped before the "cancelled" status existed were saved as "failed".
      const status: BatchStatus = row.status === "failed" && leads.some(isCancelledLead)
        ? "cancelled"
        : (row.status as BatchStatus);
      // Batches cut off by a restart are resumed at startup. Their in-flight leads restart, and so
      // do their failed ones: a lead fails on a passing error (AI or network down), worth a retry.
      if (status === "pending" || status === "running") {
        interruptedBatchIds.push(row.batchId);
        for (const lead of leads) {
          if (lead.status !== "done") {
            lead.status = "pending";
            lead.error = null;
            lead.completedAt = null;
          }
        }
      }
      store.set(row.batchId, {
        batchId: row.batchId,
        status,
        icpSnapshot: row.icpSnapshot,
        leads,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        completedCount: processedCount(leads),
        totalCount: row.totalCount,
      });
    }
    logger.info({ count: rows.length }, "Qualify batches loaded from database");
  } catch (err) {
    // Starting with an empty history would look like lost batches: the startup retries instead.
    store.clear();
    interruptedBatchIds.length = 0;
    throw err;
  }
}

export function createBatch(leads: LeadInput[], icpSnapshot: string): QualifyBatch {
  const batchId = randomUUID();
  const now = new Date().toISOString();

  const batch: QualifyBatch = {
    batchId,
    status: "pending",
    icpSnapshot,
    leads: leads.map((input) => ({
      leadId: randomUUID(),
      input,
      status: "pending",
      score: null,
      verdict: null,
      icpExplanation: null,
      keySignals: [],
      missingSignals: [],
      painPoints: [],
      venueIntel: null,
      outreachIntel: null,
      recommendedAction: null,
      crawledPages: 0,
      sourceSummary: null,
      socialProfiles: [],
      reviewAnalysis: null,
      competitorAnalysis: null,
      error: null,
      startedAt: null,
      completedAt: null,
    })),
    createdAt: now,
    updatedAt: now,
    completedCount: 0,
    totalCount: leads.length,
  };

  store.set(batchId, batch);
  void persistBatch(batch);
  return batch;
}

export function getBatch(batchId: string): QualifyBatch | undefined {
  return store.get(batchId);
}

export function listBatches(): QualifyBatch[] {
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function updateBatch(batchId: string, updates: Partial<QualifyBatch>): void {
  const batch = store.get(batchId);
  if (!batch) return;
  Object.assign(batch, updates, { updatedAt: new Date().toISOString() });
  markDirty(batchId);
  schedulePersist(batchId, FINISHED_LEAD_DELAY_MS);
}

export function updateLead(
  batchId: string,
  leadId: string,
  updates: Partial<LeadResult>,
): void {
  const batch = store.get(batchId);
  if (!batch) return;
  const index = batch.leads.findIndex((l) => l.leadId === leadId);
  if (index < 0) return;
  const lead = batch.leads[index];
  Object.assign(lead, updates);

  const done = batch.leads.filter((l) => l.status === "done" || l.status === "failed").length;
  batch.completedCount = done;
  batch.updatedAt = new Date().toISOString();

  if (done === batch.totalCount) {
    batch.status = "done";
  } else if (batch.status === "pending") {
    batch.status = "running";
  }

  markDirty(batchId, index);
  const finished = lead.status === "done" || lead.status === "failed";
  schedulePersist(batchId, finished ? FINISHED_LEAD_DELAY_MS : PROGRESS_DELAY_MS);
}
