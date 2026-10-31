/**
 * Background worker (separate from the web app): npm run worker
 * - media queue: thumbnails, viewer previews of large photos and metadata-stripped copies
 *   for share links (uploads, copies, media:backfill)
 * - maintenance queue: the daily cleanup (CLEANUP_CRON: expired accounts and items, trash,
 *   unfinished uploads, dead sessions), bandwidth samples (METRICS_SAMPLE_INTERVAL_SEC, also
 *   the worker's heartbeat), Status page probes (HEALTH_PROBE_INTERVAL_SEC) and the volume
 *   watch (VOLUME_WATCH_INTERVAL_SEC)
 * Stops cleanly on SIGINT/SIGTERM so running jobs finish before the process exits.
 */
// worker-*.log in LOG_DIR. Then .env is loaded before the app modules below; the worker runs
// until a signal, so it does not use runScript.
process.env.LOG_SERVICE ||= "worker";
await import("./lib/bootstrap.mjs");

const { startMediaWorker } = await import("../src/server/jobs/media-worker");
const { startMaintenanceWorker } = await import("../src/server/jobs/maintenance");
const { logger } = await import("../src/server/logger");
const { db } = await import("../src/server/db/client");

const media = startMediaWorker();
const maintenance = await startMaintenanceWorker();
logger.info("worker started", { queues: ["media", "maintenance"] });

async function stop(signal: string) {
  logger.info("worker stopping", { signal });
  // Exit even when a close fails, so a supervisor never waits on a half-stopped worker.
  try {
    await Promise.all([media.close(), maintenance.worker.close(), maintenance.queue.close()]);
    await db().$disconnect();
  } catch (error) {
    logger.error("worker did not stop cleanly", { error });
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
