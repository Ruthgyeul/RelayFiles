import "server-only";
import { Queue, Worker, type Job, type JobSchedulerTemplateOptions } from "bullmq";
import { getEnv } from "@/config/env";
import { JOBS, MS, STORAGE, TRANSCODE } from "@/config/policy";
import { db } from "../db/client";
import { logger } from "../logger";
import { forgetTrashedBefore } from "../repositories/trash.repo";
import { listPurgeableVolumes } from "../repositories/volume.repo";
import { recordCleanup, recordSample } from "../metrics/history";
import { runHealthProbe } from "./health-probe";
import { diskRates } from "../metrics/disks";
import { networkRates } from "../metrics/system";
import { runCleanup } from "../services/admin.service";
import { purgeOldAuditEvents } from "../services/audit.service";
import { driverFor } from "../storage/registry";
import { queueConnection } from "./queue";
import { watchVolumes } from "./volume-watch";

/** The daily cleanup, alone on its queue: however long it runs, the probes keep their schedule. */
export const MAINTENANCE_QUEUE = "maintenance";
/** The periodic probes: bandwidth and disk sample, Status page probe, volume watch. */
export const PROBES_QUEUE = "probes";
const DAILY_CLEANUP = "daily-cleanup";
const METRICS_SAMPLE = "metrics-sample";
const HEALTH_PROBE = "health-probe";
const VOLUME_WATCH = "volume-watch";
/** Schedulers that were on the maintenance queue before the probes got their own; removed at start. */
const MOVED_SCHEDULERS = [METRICS_SAMPLE, HEALTH_PROBE, VOLUME_WATCH] as const;

/** Every finish trims its queue to the newest JOBS.keepCompleted / keepFailed jobs. */
export const KEEP_HISTORY = {
  removeOnComplete: { count: JOBS.keepCompleted },
  removeOnFail: { count: JOBS.keepFailed },
} as const satisfies JobSchedulerTemplateOptions;

export interface RunningQueue {
  worker: Worker;
  queue: Queue;
}

/**
 * The daily job: expired accounts and items, then trash entries older than the retention
 * and unfinished uploads older than UPLOAD_TMP_TTL_HOURS on every ACTIVE or DRAINING volume,
 * and admin audit entries older than AUTH.auditRetentionDays.
 */
export async function runMaintenance(now: Date) {
  const cleanup = await runCleanup(now);
  await recordCleanup({ at: now.toISOString(), ...cleanup }).catch((error: unknown) => logger.warn("cleanup result not stored", { error }));
  const trashBefore = new Date(now.getTime() - STORAGE.trashRetentionHours * MS.hour);
  const uploadsBefore = new Date(now.getTime() - getEnv("uploads").UPLOAD_TMP_TTL_HOURS * MS.hour);
  const transcodedBefore = new Date(now.getTime() - TRANSCODE.cacheKeepDays * MS.day);
  let trash = 0;
  let uploads = 0;
  const emptied: string[] = [];
  for (const volume of await listPurgeableVolumes(db())) {
    const purged = await driverFor(volume).purgeSystem(trashBefore, uploadsBefore, transcodedBefore);
    trash += purged.trash;
    uploads += purged.uploads;
    emptied.push(volume.id);
  }
  // The same cut-off as the trash itself: those bytes no longer count toward anyone's storage.
  // Only on the volumes emptied above; a READONLY or OFFLINE volume still holds its trash.
  await forgetTrashedBefore(db(), trashBefore, emptied).catch((error: unknown) => logger.warn("trash records not purged", { error }));
  await purgeOldAuditEvents(now).catch((error: unknown) => logger.warn("audit log not purged", { error }));
  return { ...cleanup, trash, uploads };
}

/** Runs one probe by its name. */
export async function runProbe(name: string): Promise<unknown> {
  if (name === "metrics") {
    // Average outbound and disk rates since the previous sample (one per interval).
    const [network, disks] = await Promise.all([networkRates(), diskRates()]);
    await recordSample({ outPerSec: network.outPerSec, disks }, new Date());
    return null;
  }
  if (name === "volumes") return watchVolumes();
  if (name === "health") {
    const { probe } = await runHealthProbe(new Date());
    return probe;
  }
  logger.warn("unknown probe job skipped", { job: name });
  return null;
}

/**
 * Removes finished jobs older than `olderThanMs`, JOBS.trimBatch per Redis call: releases
 * before KEEP_HISTORY kept every job (thousands a day), and the first count-based trim would
 * otherwise remove all of them in one blocking script. Returns how many went.
 */
export async function trimFinishedJobs(queue: Queue, olderThanMs: number = JOBS.trimFinishedAfterSec * MS.second): Promise<number> {
  let removed = 0;
  for (const state of ["completed", "failed"] as const) {
    for (;;) {
      const batch = await queue.clean(olderThanMs, JOBS.trimBatch, state);
      removed += batch.length;
      if (batch.length < JOBS.trimBatch) break;
    }
  }
  return removed;
}

function watch(worker: Worker): Worker {
  worker.on("failed", (job?: Job, error?: Error) => logger.error("maintenance job failed", { queue: worker.name, job: job?.name, error }));
  worker.on("error", (error) => logger.error("maintenance worker error", { queue: worker.name, error }));
  return worker;
}

/**
 * Registers the daily cleanup (CLEANUP_CRON in JOBS_TIMEZONE) on the maintenance queue, and on
 * the probes queue the bandwidth and disk sampler (every METRICS_SAMPLE_INTERVAL_SEC, which also
 * keeps the worker heartbeat alive), the Status page probe (every HEALTH_PROBE_INTERVAL_SEC) and
 * the volume watch (every VOLUME_WATCH_INTERVAL_SEC: a volume whose SSD came off goes OFFLINE).
 * Separate queues and workers, so a long cleanup never delays noticing a detached SSD.
 */
export async function startMaintenanceWorkers(): Promise<{ cleanup: RunningQueue; probes: RunningQueue }> {
  const cleanupQueue = new Queue(MAINTENANCE_QUEUE, queueConnection("worker"));
  const probesQueue = new Queue(PROBES_QUEUE, queueConnection("worker"));
  await scheduleMaintenance(cleanupQueue, probesQueue);
  const trimmed = (await trimFinishedJobs(cleanupQueue)) + (await trimFinishedJobs(probesQueue));
  if (trimmed > 0) logger.info("old finished jobs removed", { count: trimmed });
  // The first sample only starts the rate measurement.
  await Promise.all([networkRates().catch(() => undefined), diskRates()]);

  const cleanupWorker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      // A probe job queued here by an older release is dropped, never run as a cleanup.
      if (job.name !== "cleanup") return null;
      const result = await runMaintenance(new Date());
      logger.info("cleanup finished", result);
      return result;
    },
    { ...queueConnection("worker"), concurrency: 1 },
  );
  const probesWorker = new Worker(PROBES_QUEUE, async (job) => runProbe(job.name), { ...queueConnection("worker"), concurrency: JOBS.probeConcurrency });
  return {
    cleanup: { worker: watch(cleanupWorker), queue: cleanupQueue },
    probes: { worker: watch(probesWorker), queue: probesQueue },
  };
}

/**
 * Puts the daily cleanup alone on the maintenance queue and the probes on theirs, all with a
 * bounded history (KEEP_HISTORY). Schedulers an older release put on the maintenance queue are
 * removed. Safe to run on every start (upserts).
 */
export async function scheduleMaintenance(cleanupQueue: Queue, probesQueue: Queue): Promise<void> {
  const jobs = getEnv("jobs");
  for (const id of MOVED_SCHEDULERS) await cleanupQueue.removeJobScheduler(id);
  await cleanupQueue.upsertJobScheduler(DAILY_CLEANUP, { pattern: jobs.CLEANUP_CRON, tz: jobs.JOBS_TIMEZONE }, { name: "cleanup", opts: KEEP_HISTORY });
  await probesQueue.upsertJobScheduler(METRICS_SAMPLE, { every: jobs.METRICS_SAMPLE_INTERVAL_SEC * MS.second }, { name: "metrics", opts: KEEP_HISTORY });
  await probesQueue.upsertJobScheduler(HEALTH_PROBE, { every: jobs.HEALTH_PROBE_INTERVAL_SEC * MS.second }, { name: "health", opts: KEEP_HISTORY });
  await probesQueue.upsertJobScheduler(VOLUME_WATCH, { every: getEnv("storage").VOLUME_WATCH_INTERVAL_SEC * MS.second }, { name: "volumes", opts: KEEP_HISTORY });
}
