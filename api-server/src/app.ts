import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Serve the built dashboard from the same origin so the browser can call /api directly.
// Built output lives in dashboard/dist/public (see README); override with DASHBOARD_DIST.
const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir =
  process.env.DASHBOARD_DIST ?? path.resolve(here, "../../dashboard/dist/public");
const dashboardIndex = path.join(dashboardDir, "index.html");
const hasDashboard = fs.existsSync(dashboardIndex);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// No CORS: the dashboard is served from this origin (and proxied by Vite in dev). An open CORS
// policy let any website open in the browser call the API, keyless when RECON_LOCAL=1.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// Unhandled API errors (failed database write…) answer in JSON so the dashboard can show them.
app.use("/api", (err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  req.log?.error({ err }, "Unhandled API error");
  const status =
    typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
  res.status(status).json({
    error: status >= 500 ? "Server error: the change was not saved. Try again." : (err as Error).message,
  });
});

if (hasDashboard) {
  app.use(express.static(dashboardDir));
  // SPA fallback: any non-API GET returns index.html so client-side routes work on reload
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(dashboardIndex);
  });
} else {
  logger.warn({ dashboardDir }, "Dashboard build not found; API only. Run the dashboard build to serve the UI.");
}

export default app;
