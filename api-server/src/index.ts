import app from "./app";
import { logger } from "./lib/logger";
import { initIcpStore } from "./lib/icpStore";
import { initQualifyStore } from "./lib/qualifyStore";
import { initJobStore } from "./lib/jobStore";
import { initMapsStore } from "./lib/mapsStore";
import { initConfigStore } from "./lib/configStore";

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
  await initJobStore();
  await initMapsStore();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
