import { Router, type IRouter } from "express";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import { createBatch, getBatch, listBatches, cancelBatch } from "../lib/qualifyStore.js";
import { runQualifyBatch } from "../lib/qualifyRunner.js";
import { getIcp } from "../lib/icpStore.js";
import { logger } from "../lib/logger.js";
import type { LeadInput } from "../lib/qualifyStore.js";
import { canonicalizeLeadUrl } from "../lib/leadIdentity.js";

const router: IRouter = Router();
const MAX_BATCH_SIZE = 100;

router.use(apiKeyMiddleware);

router.post("/qualify", (req, res) => {
  const body = req.body as Record<string, unknown>;

  if (!body || !Array.isArray(body.leads) || body.leads.length === 0) {
    res.status(400).json({ error: "leads must be a non-empty array" });
    return;
  }
  if (body.leads.length > MAX_BATCH_SIZE) {
    res.status(400).json({ error: `A qualification batch can contain at most ${MAX_BATCH_SIZE} leads` });
    return;
  }

  const leads: LeadInput[] = [];
  const seenUrls = new Set<string>();
  for (const item of body.leads) {
    if (!item || typeof item !== "object") {
      res.status(400).json({ error: "Each lead must be an object" });
      return;
    }
    const l = item as Record<string, unknown>;
    if (!l.name || typeof l.name !== "string") {
      res.status(400).json({ error: "Each lead must have a name string" });
      return;
    }
    if (!l.url || typeof l.url !== "string") {
      res.status(400).json({ error: "Each lead must have a url string" });
      return;
    }
    const url = String(l.url).trim();
    const normalizedUrl = canonicalizeLeadUrl(url);
    if (seenUrls.has(normalizedUrl)) continue;
    seenUrls.add(normalizedUrl);
    leads.push({
      name: String(l.name).trim(),
      url,
      category: l.category ? String(l.category) : undefined,
      city: l.city ? String(l.city) : undefined,
      country: l.country ? String(l.country) : undefined,
      notes: l.notes ? String(l.notes) : undefined,
    });
  }
  if (leads.length === 0) {
    res.status(400).json({ error: "No unique leads were provided" });
    return;
  }

  const icp = getIcp();
  const batch = createBatch(leads, icp.name);

  setImmediate(() => {
    runQualifyBatch(batch.batchId);
  });

  res.status(202).json({
    batchId: batch.batchId,
    status: "pending",
    totalCount: batch.totalCount,
    message: `Qualification batch started. Poll GET /api/qualify/${batch.batchId} for results.`,
  });
});

router.get("/qualify", (_req, res) => {
  const batches = listBatches().map((b) => ({
    batchId: b.batchId,
    status: b.status,
    icpSnapshot: b.icpSnapshot,
    totalCount: b.totalCount,
    completedCount: b.completedCount,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
  res.json({ batches });
});

router.get("/qualify/:batchId", (req, res) => {
  const batch = getBatch(req.params.batchId);
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json(batch);
});

router.post("/qualify/:batchId/stop", (req, res) => {
  const ok = cancelBatch(req.params.batchId);
  if (!ok) {
    res.status(400).json({ error: "Batch not found or not running" });
    return;
  }
  res.json({ ok: true });
});

router.post("/qualify/:batchId/retry", (req, res) => {
  const source = getBatch(req.params.batchId);
  if (!source) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const incomplete = source.leads
    .filter((l) => l.status !== "done")
    .map((l) => l.input);

  if (incomplete.length === 0) {
    res.status(400).json({ error: "No incomplete leads to retry" });
    return;
  }

  const icp = getIcp();
  const newBatch = createBatch(incomplete, icp.name);

  setImmediate(() => {
    runQualifyBatch(newBatch.batchId);
  });

  res.status(202).json({
    batchId: newBatch.batchId,
    status: "pending",
    totalCount: newBatch.totalCount,
    message: `Retrying ${newBatch.totalCount} incomplete leads.`,
  });
});

export default router;
