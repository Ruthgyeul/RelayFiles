import "server-only";
import { Queue, Worker } from "bullmq";
import { getEnv } from "@/config/env";
import { MS, STORAGE } from "@/config/policy";
import { db } from "../db/client";
import { logger } from "../logger";
import { listActiveVolumes } from "../repositories/volume.repo";
import { runCleanup } from "../services/admin.service";
import { driverFor } from "../storage/registry";
import { queueConnection } from "./queue";

export const MAINTENANCE_QUEUE = "maintenance";
const DAILY_CLEANUP = "daily-cleanup";

/**
 * The daily job: expired accounts and items, then trash entries older than the retention
 * and unfinished uploads older than UPLOAD_TMP_TTL_HOURS on every volume.
 */
export async function runMaintenance(now: Date) {
  const cleanup = await runCleanup(now);
  const trashBefore = new Date(now.getTime() - STORAGE.trashRetentionHours * MS.hour);
  const uploadsBefore = new Date(now.getTime() - getEnv("uploads").UPLOAD_TMP_TTL_HOURS * MS.hour);
  let trash = 0;
  let uploads = 0;
  for (const volume of await listActiveVolumes(db())) {
    const purged = await driverFor(volume).purgeSystem(trashBefore, uploadsBefore);
    trash += purged.trash;
    uploads += purged.uploads;
  }
  return { ...cleanup, trash, uploads };
}

/** Registers the daily schedule (CLEANUP_CRON in JOBS_TIMEZONE) and processes it. */
export async function startMaintenanceWorker(): Promise<{ worker: Worker; queue: Queue }> {
  const jobs = getEnv("jobs");
  const queue = new Queue(MAINTENANCE_QUEUE, queueConnection("worker"));
  await queue.upsertJobScheduler(DAILY_CLEANUP, { pattern: jobs.CLEANUP_CRON, tz: jobs.JOBS_TIMEZONE }, { name: "cleanup" });
  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async () => {
      const result = await runMaintenance(new Date());
      logger.info("cleanup finished", result);
      return result;
    },
    { ...queueConnection("worker"), concurrency: 1 },
  );
  worker.on("failed", (_job, error) => logger.error("cleanup failed", { error: error.message }));
  return { worker, queue };
}
