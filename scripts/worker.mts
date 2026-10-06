/**
 * Background worker (separate from the web app): npm run worker
 * Builds thumbnails and metadata-stripped copies for public links, and runs the daily
 * cleanup (expired accounts and items, trash, unfinished uploads). Stops cleanly on
 * SIGINT/SIGTERM so running jobs finish before the process exits.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { startMediaWorker } = await import("../src/server/jobs/media.worker");
const { startMaintenanceWorker } = await import("../src/server/jobs/maintenance");
const { logger } = await import("../src/server/logger");
const { db } = await import("../src/server/db/client");

const media = startMediaWorker();
const maintenance = await startMaintenanceWorker();
logger.info("worker started", { queues: ["media", "maintenance"] });

async function stop(signal: string) {
  logger.info("worker stopping", { signal });
  await Promise.all([media.close(), maintenance.worker.close(), maintenance.queue.close()]);
  await db().$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
