import { Router, type IRouter } from "express";
import { claudeModel, isClaudeConfigured } from "../lib/qualify/claudeClient.js";

const router: IRouter = Router();

// No key needed: the dashboard reads it to know whether it must ask for an access key.
// It tells nothing secret (local or shared, AI on or off).
router.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    local: process.env.RECON_LOCAL === "1",
    ai: isClaudeConfigured() ? { provider: "claude", model: claudeModel() } : null,
  });
});

export default router;
