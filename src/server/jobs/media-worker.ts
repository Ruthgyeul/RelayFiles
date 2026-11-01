import "server-only";
import { Worker } from "bullmq";
import { getEnv } from "@/config/env";
import { logger } from "../logger";
import { processMedia, recordDateTaken } from "../media/process";
import { storeTranscode } from "../media/transcode-cache";
import { MEDIA_QUEUE, queueConnection, type MediaJob } from "./queue";

/** Runs one media job by its task; `signal` aborts when the worker stops (only long conversions watch it). */
function runMediaJob({ nodeId, task }: MediaJob, signal?: AbortSignal): Promise<unknown> {
  if (task === "transcode") return storeTranscode(nodeId, signal);
  if (task === "taken") return recordDateTaken(nodeId);
  return processMedia(nodeId);
}

/**
 * Consumes the media queue: thumbnails, metadata-stripped copies, dates taken and stored video
 * conversions (separate process). Stop it with {@link stopMediaWorker} so a long conversion
 * does not hold up the shutdown.
 */
export function startMediaWorker(): Worker<MediaJob> {
  const worker = new Worker<MediaJob>(MEDIA_QUEUE, async (job, _token, signal) => runMediaJob(job.data, signal), {
    ...queueConnection("worker"),
    concurrency: getEnv("jobs").MEDIA_WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, error) => logger.error("media job failed", { nodeId: job?.data.nodeId, attempts: job?.attemptsMade, error }));
  worker.on("error", (error) => logger.error("media worker error", { error }));
  return worker;
}

/**
 * Stops taking jobs, aborts running stored conversions (ffmpeg gets SIGTERM, then SIGKILL; the
 * job fails and is tried again after the restart) and waits for the short jobs to finish.
 */
export async function stopMediaWorker(worker: Worker<MediaJob>): Promise<void> {
  const closing = worker.close();
  worker.cancelAllJobs("worker stopping");
  await closing;
}
