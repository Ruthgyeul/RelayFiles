import "server-only";
import { Worker } from "bullmq";
import { getEnv } from "@/config/env";
import { logger } from "../logger";
import { processMedia } from "../media/process";
import { storeTranscode } from "../media/transcode-cache";
import { MEDIA_QUEUE, queueConnection, type MediaJob } from "./queue";

/** Consumes the media queue: thumbnails, metadata-stripped copies and stored video conversions (separate process). */
export function startMediaWorker(): Worker<MediaJob> {
  const worker = new Worker<MediaJob>(MEDIA_QUEUE, async (job) => (job.data.task === "transcode" ? storeTranscode(job.data.nodeId) : processMedia(job.data.nodeId)), {
    ...queueConnection("worker"),
    concurrency: getEnv("jobs").MEDIA_WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, error) => logger.error("media job failed", { nodeId: job?.data.nodeId, attempts: job?.attemptsMade, error }));
  worker.on("error", (error) => logger.error("media worker error", { error }));
  return worker;
}
