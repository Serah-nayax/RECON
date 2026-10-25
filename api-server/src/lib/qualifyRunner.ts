import { getBatch, isBatchCancelled, onBatchCancelled, updateLead } from "./qualifyStore.js";
import { getIcp } from "./icpStore.js";
import { qualifyLead } from "./qualifyLead.js";
import { logger } from "./logger.js";

const BATCH_CONCURRENCY = 1;
let availableQualificationSlots = 1;
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

  const queue = [...batch.leads];
  let activeCount = 0;

  await new Promise<void>((resolve) => {
    function processNext() {
      if (isBatchCancelled(batchId)) {
        if (activeCount === 0) resolve();
        return;
      }

      while (activeCount < BATCH_CONCURRENCY && queue.length > 0) {
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

  logger.info({ batchId }, "Qualify batch complete");
}
