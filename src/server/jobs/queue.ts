import "server-only";
import { Queue, type ConnectionOptions } from "bullmq";
import { getEnv, redisUrlOf } from "@/config/env";
import { MEDIA } from "@/config/policy";
import { logger } from "../logger";

export const MEDIA_QUEUE = "media";

export interface MediaJob {
  nodeId: string;
}

/**
 * BullMQ connection settings. BullMQ manages its own key prefix (ioredis `keyPrefix` is not
 * supported), so queues live under REDIS_KEY_PREFIX + "q" (e.g. `rf:v1:q:media:*`).
 */
export function queueConnection(role: "producer" | "worker"): { connection: ConnectionOptions; prefix: string } {
  const env = getEnv("redis");
  // Workers block on Redis and must wait it out; the web app adds jobs and must fail fast.
  const connection: ConnectionOptions =
    role === "worker" ? { url: redisUrlOf(env), maxRetriesPerRequest: null } : { url: redisUrlOf(env), maxRetriesPerRequest: 1, enableOfflineQueue: false };
  return { connection, prefix: `${env.REDIS_KEY_PREFIX}q` };
}

const globalForQueue = globalThis as unknown as { relayMediaQueue?: Queue<MediaJob> };

function mediaQueue(): Queue<MediaJob> {
  globalForQueue.relayMediaQueue ??= new Queue<MediaJob>(MEDIA_QUEUE, {
    ...queueConnection("producer"),
    defaultJobOptions: {
      attempts: MEDIA.jobAttempts,
      backoff: { type: "exponential", delay: MEDIA.jobBackoffMs },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return globalForQueue.relayMediaQueue;
}

/**
 * Asks the worker to (re)build thumbnails and metadata-stripped copies. A pending job for the
 * same node is reused. Never fails the caller: without Redis the files simply have no
 * thumbnail until `npm run media:backfill` runs.
 */
export async function enqueueMedia(nodeIds: readonly string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  try {
    await mediaQueue().addBulk(nodeIds.map((nodeId) => ({ name: "process", data: { nodeId }, opts: { jobId: nodeId } })));
  } catch (error) {
    logger.warn("media jobs not queued", { error, count: nodeIds.length });
  }
}

/** Closes the producer connection (scripts and tests that exit). */
export async function closeQueues(): Promise<void> {
  await globalForQueue.relayMediaQueue?.close();
  globalForQueue.relayMediaQueue = undefined;
}
