import { getBatch, isBatchCancelled, onBatchCancelled, updateBatch, updateLead } from "./qualifyStore.js";
import { getIcp } from "../icpStore.js";
import { qualifyLead } from "./qualifyLead.js";
import { logger } from "../logger.js";

// Leads run in parallel even with Gemini: crawling is plain HTTP, and the free-tier quota is
// enforced per AI call (geminiLimiter.ts). Before, one lead at a time meant every crawl also
// waited for the previous lead's AI call. Without AI, 16 leads at once (~48 page fetches beside
// the local scoring model) left half the sites of a 44-lead batch unread on timeouts.
export const QUALIFY_CONCURRENCY = Number(process.env.QUALIFY_CONCURRENCY ?? 8);
let availableQualificationSlots = QUALIFY_CONCURRENCY;
const qualificationWaiters: Array<{
  resolve: () => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
}> = [];

function createSlotRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = qualificationWaiters.shift();
    if (next) {
      next.signal.removeEventListener("abort", next.onAbort);
      next.resolve();
    } else {
      availableQualificationSlots++;
    }
  };
}

async function acquireQualificationSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new Error("Qualification cancelled");
  if (availableQualificationSlots > 0) {
    availableQualificationSlots--;
    return createSlotRelease();
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = qualificationWaiters.indexOf(waiter);
        if (index >= 0) qualificationWaiters.splice(index, 1);
        reject(new Error("Qualification cancelled"));
      },
    };
    signal.addEventListener("abort", waiter.onAbort, { once: true });
    qualificationWaiters.push(waiter);
  });
  return createSlotRelease();
}

export async function runQualifyBatch(batchId: string): Promise<void> {
  const batch = getBatch(batchId);
  if (!batch) return;

  const icp = getIcp();

  logger.info({ batchId, totalLeads: batch.leads.length }, "Starting qualify batch");

  // Skip finished leads so a batch resumed after a restart only does what's left.
  const queue = batch.leads.filter((l) => l.status !== "done" && l.status !== "failed");
  let activeCount = 0;

  await new Promise<void>((resolve) => {
    function processNext() {
      if (isBatchCancelled(batchId)) {
        if (activeCount === 0) resolve();
        return;
      }

      while (activeCount < QUALIFY_CONCURRENCY && queue.length > 0) {
        if (isBatchCancelled(batchId)) break;
        const lead = queue.shift()!;
        activeCount++;

        (async () => {
          const abortController = new AbortController();
          const unregisterCancellation = onBatchCancelled(batchId, () => abortController.abort());
          let releaseSlot: (() => void) | null = null;

          try {
            releaseSlot = await acquireQualificationSlot(abortController.signal);
            if (isBatchCancelled(batchId)) return;
            updateLead(batchId, lead.leadId, {
              status: "crawling",
              startedAt: new Date().toISOString(),
            });

            const result = await qualifyLead(lead.input, icp, (phase) => {
              updateLead(batchId, lead.leadId, { status: phase === "scoring" ? "scoring" : "crawling" });
            }, abortController.signal);

            if (!isBatchCancelled(batchId)) {
              updateLead(batchId, lead.leadId, {
                status: "done",
                score: result.score,
                verdict: result.verdict,
                icpExplanation: result.icpExplanation,
                keySignals: result.keySignals,
                missingSignals: result.missingSignals,
                painPoints: result.painPoints,
                venueIntel: result.venueIntel,
                outreachIntel: result.outreachIntel,
                recommendedAction: result.recommendedAction,
                crawledPages: result.crawledPages,
                sourceSummary: result.sourceSummary,
                socialProfiles: result.socialProfiles,
                reviewAnalysis: result.reviewAnalysis,
                competitorAnalysis: result.competitorAnalysis,
                completedAt: new Date().toISOString(),
              });

              logger.info({ batchId, leadId: lead.leadId, name: lead.input.name, score: result.score }, "Lead qualified");
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!isBatchCancelled(batchId)) {
              logger.error({ batchId, leadId: lead.leadId, err: message }, "Lead qualification failed");
              updateLead(batchId, lead.leadId, {
                status: "failed",
                error: message,
                completedAt: new Date().toISOString(),
              });
            }
          } finally {
            unregisterCancellation();
            releaseSlot?.();
          }

          activeCount--;
          processNext();

          const currentBatch = getBatch(batchId);
          if (currentBatch && currentBatch.completedCount === currentBatch.totalCount) {
            resolve();
          }
        })();
      }

      const currentBatch = getBatch(batchId);
      if (currentBatch && activeCount === 0 && queue.length === 0) {
        resolve();
      }
    }

    processNext();
  });

  // A resumed batch with nothing left never goes through updateLead's "done" check.
  const finished = getBatch(batchId);
  if (finished && finished.status !== "done" && !isBatchCancelled(batchId) &&
      finished.leads.every((l) => l.status === "done" || l.status === "failed")) {
    updateBatch(batchId, { status: "done" });
  }

  logger.info({ batchId }, "Qualify batch complete");
}
