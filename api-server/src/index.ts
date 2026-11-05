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

async function start() {
  await initConfigStore();
  await initIcpStore();
  await initQualifyStore();
  await initMapsStore();
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

  // Save debounced Maps updates before exiting (Ctrl+C, or closing the console window = SIGHUP).
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
