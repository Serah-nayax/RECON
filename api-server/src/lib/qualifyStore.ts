import { randomUUID } from "crypto";
import { db, qualifyBatches } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import type { ReviewAnalysis } from "./analyzeReviews.js";
import type { CompetitorAnalysis } from "./analyzeCompetitor.js";

export type LeadStatus = "pending" | "crawling" | "scoring" | "done" | "failed";
export type BatchStatus = "pending" | "running" | "done" | "failed";

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
  batch.status = "failed";
  for (const lead of batch.leads) {
    if (lead.status !== "done" && lead.status !== "failed") {
      lead.status = "failed";
      lead.error = "Qualification cancelled";
      lead.completedAt = now;
    }
  }
  batch.completedCount = batch.totalCount;
  batch.updatedAt = now;
  store.set(batchId, batch);
  void persistBatch(batch);
  return true;
}

export function isBatchCancelled(batchId: string): boolean {
  return cancelledBatches.has(batchId);
}

async function persistBatch(batch: QualifyBatch): Promise<void> {
  try {
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
  } catch (err) {
    logger.error({ err, batchId: batch.batchId }, "Failed to persist batch to DB");
  }
}

export async function initQualifyStore(): Promise<void> {
  try {
    const rows = await db.select().from(qualifyBatches);
    for (const row of rows) {
      store.set(row.batchId, {
        batchId: row.batchId,
        status: row.status as BatchStatus,
        icpSnapshot: row.icpSnapshot,
        leads: row.leads as unknown as LeadResult[],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        completedCount: row.completedCount,
        totalCount: row.totalCount,
      });
    }
    logger.info({ count: rows.length }, "Qualify batches loaded from database");
  } catch (err) {
    logger.error({ err }, "Failed to load qualify batches from DB");
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
  void persistBatch(batch);
}

export function updateLead(
  batchId: string,
  leadId: string,
  updates: Partial<LeadResult>,
): void {
  const batch = store.get(batchId);
  if (!batch) return;
  const lead = batch.leads.find((l) => l.leadId === leadId);
  if (!lead) return;
  Object.assign(lead, updates);

  const done = batch.leads.filter((l) => l.status === "done" || l.status === "failed").length;
  batch.completedCount = done;
  batch.updatedAt = new Date().toISOString();

  if (done === batch.totalCount) {
    batch.status = "done";
  } else if (batch.status === "pending") {
    batch.status = "running";
  }

  void persistBatch(batch);
}
