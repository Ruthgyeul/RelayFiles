import "server-only";
import { Queue, Worker } from "bullmq";
import { getEnv } from "@/config/env";
import { MS, STORAGE } from "@/config/policy";
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

export const MAINTENANCE_QUEUE = "maintenance";
const DAILY_CLEANUP = "daily-cleanup";
const METRICS_SAMPLE = "metrics-sample";
const HEALTH_PROBE = "health-probe";
const VOLUME_WATCH = "volume-watch";

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
  let trash = 0;
  let uploads = 0;
  for (const volume of await listPurgeableVolumes(db())) {
    const purged = await driverFor(volume).purgeSystem(trashBefore, uploadsBefore);
    trash += purged.trash;
    uploads += purged.uploads;
  }
  // The same cut-off as the trash itself: those bytes no longer count toward anyone's storage.
  await forgetTrashedBefore(db(), trashBefore).catch((error: unknown) => logger.warn("trash records not purged", { error }));
  await purgeOldAuditEvents(now).catch((error: unknown) => logger.warn("audit log not purged", { error }));
  return { ...cleanup, trash, uploads };
}

/**
 * Registers the daily cleanup (CLEANUP_CRON in JOBS_TIMEZONE) and the bandwidth and disk sampler
 * (every METRICS_SAMPLE_INTERVAL_SEC, which also keeps the worker heartbeat alive) and the
 * Status page probe (every HEALTH_PROBE_INTERVAL_SEC), and the volume watch (every
 * VOLUME_WATCH_INTERVAL_SEC: a volume whose SSD came off goes OFFLINE).
 */
export async function startMaintenanceWorker(): Promise<{ worker: Worker; queue: Queue }> {
  const jobs = getEnv("jobs");
  const queue = new Queue(MAINTENANCE_QUEUE, queueConnection("worker"));
  await queue.upsertJobScheduler(DAILY_CLEANUP, { pattern: jobs.CLEANUP_CRON, tz: jobs.JOBS_TIMEZONE }, { name: "cleanup" });
  await queue.upsertJobScheduler(METRICS_SAMPLE, { every: jobs.METRICS_SAMPLE_INTERVAL_SEC * MS.second }, { name: "metrics" });
  await queue.upsertJobScheduler(HEALTH_PROBE, { every: jobs.HEALTH_PROBE_INTERVAL_SEC * MS.second }, { name: "health" });
  await queue.upsertJobScheduler(VOLUME_WATCH, { every: getEnv("storage").VOLUME_WATCH_INTERVAL_SEC * MS.second }, { name: "volumes" });
  // The first sample only starts the rate measurement.
  await Promise.all([networkRates().catch(() => undefined), diskRates()]);
  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === "metrics") {
        // Average outbound and disk rates since the previous sample (one per interval).
        const [network, disks] = await Promise.all([networkRates(), diskRates()]);
        await recordSample({ outPerSec: network.outPerSec, disks }, new Date());
        return null;
      }
      if (job.name === "volumes") return watchVolumes();
      if (job.name === "health") {
        const { probe } = await runHealthProbe(new Date());
        return probe;
      }
      const result = await runMaintenance(new Date());
      logger.info("cleanup finished", result);
      return result;
    },
    { ...queueConnection("worker"), concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.error("maintenance job failed", { job: job?.name, error }));
  return { worker, queue };
}
