import { Router, type IRouter, type Request, type Response } from "express";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import { listConfigs, setConfig, deleteConfig } from "../lib/configStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use(apiKeyMiddleware);

router.get("/config", async (_req: Request, res: Response) => {
  try {
    const configs = await listConfigs();
    res.json({ configs });
  } catch (err) {
    logger.error({ err }, "Failed to list config");
    res.status(500).json({ error: "Failed to list config" });
  }
});

router.put("/config/:key", async (req: Request, res: Response) => {
  const { key } = req.params;
  const { value, label, category } = req.body as { value: string; label: string; category?: string };

  if (!key || !value || !label) {
    res.status(400).json({ error: "key, value, and label are required" });
    return;
  }

  try {
    await setConfig(key, value, label, category ?? "custom");
    res.json({ success: true, key });
  } catch (err) {
    logger.error({ err, key }, "Failed to save config");
    res.status(500).json({ error: "Failed to save config" });
  }
});

router.delete("/config/:key", async (req: Request, res: Response) => {
  const { key } = req.params;
  try {
    await deleteConfig(key);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, key }, "Failed to delete config");
    res.status(500).json({ error: "Failed to delete config" });
  }
});

export default router;
