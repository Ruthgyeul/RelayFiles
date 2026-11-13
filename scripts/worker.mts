/**
 * Background worker (separate from the web app): npm run worker
 * - media queue: thumbnails, viewer previews of large photos and metadata-stripped copies
 *   for share links (uploads, copies, media:backfill)
 * - maintenance queue: the daily cleanup (CLEANUP_CRON: expired accounts and items, trash,
 *   unfinished uploads, dead sessions)
 * - probes queue (its own worker, so a long cleanup never delays it): bandwidth samples
 *   (METRICS_SAMPLE_INTERVAL_SEC, also the worker's heartbeat), Status page probes
 *   (HEALTH_PROBE_INTERVAL_SEC) and the volume watch (VOLUME_WATCH_INTERVAL_SEC)
 * - notify queue: owner notifications posted to NOTIFY_WEBHOOK_URL (file requests, low or offline
 *   volumes, failed backup checks), with retries
 * WORKER_ROLES picks which of these this process runs (media; maintenance = cleanup + probes;
 * notify), so media jobs can run in more processes on other machines (k3s media workers on the
 * Pi nodes, docs/deploy-k3s.md) while the one storage-host worker keeps the rest.
 * Stops cleanly on SIGINT/SIGTERM: running jobs finish before the process exits, except stored
 * video conversions, which are stopped and tried again after the restart.
 */
// worker-*.log in LOG_DIR. Then .env is loaded before the app modules below; the worker runs
// until a signal, so it does not use runScript.
process.env.LOG_SERVICE ||= "worker";
await import("./lib/bootstrap.mjs");

const { getEnv } = await import("../src/config/env");
const { startMediaWorker, stopMediaWorker } = await import("../src/server/jobs/media-worker");
const { MAINTENANCE_QUEUE, PROBES_QUEUE, startMaintenanceWorkers } = await import("../src/server/jobs/maintenance");
const { startNotifyWorker } = await import("../src/server/jobs/notify-worker");
const { closeNotifyQueue, NOTIFY_QUEUE, notifyEnabled } = await import("../src/server/jobs/notify-queue");
const { logger } = await import("../src/server/logger");
const { db } = await import("../src/server/db/client");

const roles = new Set(getEnv("jobs").WORKER_ROLES);
// Reads (and validates) the NOTIFY_* settings first, so a bad webhook URL stops the worker at start.
const notifications = notifyEnabled();

/** What stop() closes, in no particular order: each role adds its own. */
const closers: (() => Promise<unknown>)[] = [];
const queues: string[] = [];
if (roles.has("media")) {
  const media = startMediaWorker();
  closers.push(() => stopMediaWorker(media));
  queues.push(media.name);
}
if (roles.has("maintenance")) {
  const { cleanup, probes } = await startMaintenanceWorkers();
  closers.push(...[cleanup, probes].flatMap(({ worker, queue }) => [() => worker.close(), () => queue.close()]));
  queues.push(MAINTENANCE_QUEUE, PROBES_QUEUE);
}
if (roles.has("notify")) {
  const notify = startNotifyWorker();
  closers.push(() => notify.close());
  queues.push(NOTIFY_QUEUE);
}
logger.info("worker started", { roles: [...roles], queues, notifications });

async function stop(signal: string) {
  logger.info("worker stopping", { signal });
  // Exit even when a close fails, so a supervisor never waits on a half-stopped worker.
  try {
    await Promise.all(closers.map((close) => close()));
    // The volume watch and media jobs queue notifications through the producer side.
    await closeNotifyQueue();
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
