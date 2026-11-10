import app from "./app";
import { logger } from "./lib/logger";
import { initIcpStore } from "./lib/icpStore";
import { flushQualifyStore, initQualifyStore, takeInterruptedBatchIds } from "./lib/qualify/qualifyStore";
import { runQualifyBatch } from "./lib/qualify/qualifyRunner";
import { flushMapsStore, initMapsStore } from "./lib/maps/mapsStore";
import { initConfigStore } from "./lib/configStore";
import { warmUpIcpScoring } from "./lib/qualify/icpScoring";
import { preloadGazetteer } from "./lib/maps/gazetteer";
import { resumeInterruptedMapsJobs } from "./lib/maps/mapsJobRunner";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const LOAD_ATTEMPTS = 6;

// A load that fails (DNS hiccup, connection cut) is retried: starting with empty data would show
// no history and the example ICP, and later saves could build on that. After ~1 min of failures
// the server stops with a clear message rather than run on partial data.
async function loadWithRetry(name: string, load: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await load();
      return;
    } catch (err) {
      const message = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      if (attempt >= LOAD_ATTEMPTS) {
        throw new Error(`Could not load ${name} from the database after ${attempt} tries: ${message}`);
      }
      const waitMs = Math.min(2000 * 2 ** (attempt - 1), 20_000);
      logger.warn({ data: name, attempt, waitMs, error: message }, "Database load failed, retrying");
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function start() {
  // Independent tables, loaded side by side: on a slow network the batches and searches
  // (several MB) took minutes one after the other.
  const loadStart = Date.now();
  await Promise.all([
    loadWithRetry("settings", initConfigStore),
    loadWithRetry("ICPs", initIcpStore),
    loadWithRetry("qualify batches", initQualifyStore),
    loadWithRetry("Maps searches", initMapsStore),
  ]);
  logger.info({ ms: Date.now() - loadStart }, "Data loaded from database");
  warmUpIcpScoring();
  preloadGazetteer();

  // Local mode skips the API key, so it must not be reachable from other machines.
  const host = process.env.RECON_LOCAL === "1" ? "127.0.0.1" : "0.0.0.0";

  app.listen(port, host, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port, host }, "Server listening");
    resumeInterruptedMapsJobs();
    for (const batchId of takeInterruptedBatchIds()) {
      logger.info({ batchId }, "Resuming interrupted qualify batch");
      void runQualifyBatch(batchId);
    }
  });

  // Save pending Maps and Qualify updates before exiting (Ctrl+C, or closing the console window = SIGHUP).
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      logger.info({ signal }, "Shutting down, saving pending data");
      void Promise.all([flushMapsStore(), flushQualifyStore()]).finally(() => process.exit(0));
    });
  }
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
