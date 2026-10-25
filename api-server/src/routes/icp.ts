import { Router, type IRouter } from "express";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import {
  getIcp,
  listIcps,
  getIcpById,
  createIcp,
  updateIcpById,
  activateIcp,
  deleteIcp,
  resetIcp,
} from "../lib/icpStore.js";

const router: IRouter = Router();

router.use(apiKeyMiddleware);

router.get("/icp", (_req, res) => {
  res.json({ icps: listIcps(), active: getIcp() });
});

router.post("/icp", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Request body must be a JSON object" });
    return;
  }

  const required = ["name", "description", "systemPrompt", "qualifySignals", "disqualifySignals", "scoreBands"] as const;
  for (const field of required) {
    if (!(field in body)) {
      res.status(400).json({ error: `Missing required field: ${field}` });
      return;
    }
  }

  const icp = await createIcp({
    name: String(body.name),
    description: String(body.description),
    systemPrompt: String(body.systemPrompt),
    qualifySignals: body.qualifySignals as string[],
    disqualifySignals: body.disqualifySignals as string[],
    scoreBands: body.scoreBands as { band: string; range: string; description: string }[],
  });
  res.status(201).json(icp);
});

router.get("/icp/active", (_req, res) => {
  res.json(getIcp());
});

router.get("/icp/:id", (req, res) => {
  const icp = getIcpById(req.params.id);
  if (!icp) {
    res.status(404).json({ error: "ICP not found" });
    return;
  }
  res.json(icp);
});

router.put("/icp/:id", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Request body must be a JSON object" });
    return;
  }

  const allowed = ["name", "description", "systemPrompt", "qualifySignals", "disqualifySignals", "scoreBands"] as const;
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  const updated = await updateIcpById(req.params.id, updates as Parameters<typeof updateIcpById>[1]);
  if (!updated) {
    res.status(404).json({ error: "ICP not found" });
    return;
  }
  res.json(updated);
});

router.post("/icp/:id/activate", async (req, res) => {
  const activated = await activateIcp(req.params.id);
  if (!activated) {
    res.status(404).json({ error: "ICP not found" });
    return;
  }
  res.json(activated);
});

router.delete("/icp/:id", async (req, res) => {
  const deleted = await deleteIcp(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "ICP not found" });
    return;
  }
  res.json({ success: true });
});

router.post("/icp/reset", async (_req, res) => {
  res.json(await resetIcp());
});

export default router;
