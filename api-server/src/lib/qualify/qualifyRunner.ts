import { getBatch, isBatchCancelled, onBatchCancelled, updateBatch, updateLead } from "./qualifyStore.js";
import { getIcp } from "../icpStore.js";
import { aiUsageOfError, qualifyLead, SiteUnreadError } from "./qualifyLead.js";
import { logger } from "../logger.js";
import { isClaudeConfigured } from "./claudeClient.js";

// Leads run in parallel. Without AI, 16 leads at once (~48 page fetches beside
// the local scoring model) left half the sites of a 44-lead batch unread on timeouts. With Claude
// the scoring runs off this machine and the key allows far more requests (45,000 a minute), so
// 16 leads run at once: a 500-place search qualifies in about half the time, at the same cost.
export const QUALIFY_CONCURRENCY = Number(process.env.QUALIFY_CONCURRENCY ?? (isClaudeConfigured() ? 16 : 8));
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
  const firstRound = batch.leads.filter((l) => l.status !== "done" && l.status !== "failed");

  // A lead whose site gives nothing is put aside, then read again once the rest of the batch is
  // done. In a Nov 2026 test a network cut of about a minute left every site of a batch unread,
  // and all were scored as if they had no website: the Mountain Mike's arcades fell from 70 to
  // 10-30. A site still unread on the second round is scored without it, as before.
  const putAside = await runRound(batchId, icp, firstRound, true);
  if (putAside.length > 0 && !isBatchCancelled(batchId)) {
    logger.info({ batchId, leads: putAside.length }, "Websites unread, trying them again at the end of the batch");
    await waitUnlessCancelled(batchId, UNREAD_SITE_RETRY_DELAY_MS);
    if (!isBatchCancelled(batchId)) await runRound(batchId, icp, putAside, false);
  }

  // A resumed batch with nothing left never goes through updateLead's "done" check.
  const finished = getBatch(batchId);
  if (finished && finished.status !== "done" && !isBatchCancelled(batchId) &&
      finished.leads.every((l) => l.status === "done" || l.status === "failed")) {
    updateBatch(batchId, { status: "done" });
  }

  logger.info({ batchId }, "Qualify batch complete");
}

const UNREAD_SITE_RETRY_DELAY_MS = 30_000;

function waitUnlessCancelled(batchId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const unregister = onBatchCancelled(batchId, done);
    function done() {
      clearTimeout(timer);
      unregister();
      resolve();
    }
  });
}

/** Qualifies the leads; returns those put aside because their website could not be read. */
async function runRound(
  batchId: string,
  icp: ReturnType<typeof getIcp>,
  leads: Array<{ leadId: string; input: Parameters<typeof qualifyLead>[0] }>,
  deferIfSiteUnread: boolean,
): Promise<typeof leads> {
  const queue = [...leads];
  const putAside: typeof leads = [];
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
            }, abortController.signal, { deferIfSiteUnread });

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
                aiUsage: result.aiUsage ?? null,
                completedAt: new Date().toISOString(),
              });

              logger.info({ batchId, leadId: lead.leadId, name: lead.input.name, score: result.score }, "Lead qualified");
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (err instanceof SiteUnreadError) {
              putAside.push(lead);
              updateLead(batchId, lead.leadId, { status: "pending" });
            } else if (!isBatchCancelled(batchId)) {
              logger.error({ batchId, leadId: lead.leadId, err: message }, "Lead qualification failed");
              updateLead(batchId, lead.leadId, {
                status: "failed",
                error: message,
                // Calls made before the failure were billed: keep them in the batch and month costs.
                aiUsage: aiUsageOfError(err),
                completedAt: new Date().toISOString(),
              });
            }
          } finally {
            unregisterCancellation();
            releaseSlot?.();
            // In finally: a lead stopped by a cancel returns early and must still free its place,
            // or the batch run never ends.
            activeCount--;
            processNext();
          }
        })();
      }

      if (activeCount === 0 && queue.length === 0) {
        resolve();
      }
    }

    processNext();
  });

  return putAside;
}
