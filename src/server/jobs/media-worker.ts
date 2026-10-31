import "server-only";
import { Worker } from "bullmq";
import { getEnv } from "@/config/env";
import { logger } from "../logger";
import { processMedia, recordDateTaken } from "../media/process";
import { storeTranscode } from "../media/transcode-cache";
import { MEDIA_QUEUE, queueConnection, type MediaJob } from "./queue";

/** Runs one media job by its task. */
function runMediaJob({ nodeId, task }: MediaJob): Promise<unknown> {
  if (task === "transcode") return storeTranscode(nodeId);
  if (task === "taken") return recordDateTaken(nodeId);
  return processMedia(nodeId);
}

/** Consumes the media queue: thumbnails, metadata-stripped copies, dates taken and stored video conversions (separate process). */
export function startMediaWorker(): Worker<MediaJob> {
  const worker = new Worker<MediaJob>(MEDIA_QUEUE, async (job) => runMediaJob(job.data), {
    ...queueConnection("worker"),
    concurrency: getEnv("jobs").MEDIA_WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, error) => logger.error("media job failed", { nodeId: job?.data.nodeId, attempts: job?.attemptsMade, error }));
  worker.on("error", (error) => logger.error("media worker error", { error }));
  return worker;
}
