/**
 * Background worker (separate from the web app): npm run worker
 * - media queue: thumbnails, viewer previews of large photos and metadata-stripped copies
 *   for share links (uploads, copies, media:backfill)
 * - maintenance queue: the daily cleanup (CLEANUP_CRON: expired accounts and items, trash,
 *   unfinished uploads, dead sessions)
 * - probes queue (its own worker, so a long cleanup never delays it): bandwidth samples
 *   (METRICS_SAMPLE_INTERVAL_SEC, also the worker's heartbeat), Status page probes
 *   (HEALTH_PROBE_INTERVAL_SEC) and the volume watch (VOLUME_WATCH_INTERVAL_SEC)
 * Stops cleanly on SIGINT/SIGTERM: running jobs finish before the process exits, except stored
 * video conversions, which are stopped and tried again after the restart.
 */
// worker-*.log in LOG_DIR. Then .env is loaded before the app modules below; the worker runs
// until a signal, so it does not use runScript.
process.env.LOG_SERVICE ||= "worker";
await import("./lib/bootstrap.mjs");

const { startMediaWorker, stopMediaWorker } = await import("../src/server/jobs/media-worker");
const { MAINTENANCE_QUEUE, PROBES_QUEUE, startMaintenanceWorkers } = await import("../src/server/jobs/maintenance");
const { logger } = await import("../src/server/logger");
const { db } = await import("../src/server/db/client");

const media = startMediaWorker();
const { cleanup, probes } = await startMaintenanceWorkers();
logger.info("worker started", { queues: [media.name, MAINTENANCE_QUEUE, PROBES_QUEUE] });

async function stop(signal: string) {
  logger.info("worker stopping", { signal });
  // Exit even when a close fails, so a supervisor never waits on a half-stopped worker.
  try {
    await Promise.all([stopMediaWorker(media), ...[cleanup, probes].flatMap(({ worker, queue }) => [worker.close(), queue.close()])]);
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
