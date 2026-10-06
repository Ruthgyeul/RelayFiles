import "server-only";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { METRICS } from "@/config/policy";
import { redis } from "../redis";

/** Written by the worker; read by the Server page. Redis holds only what can be measured again. */
const HISTORY_KEY = "metrics:net-out";
const HEARTBEAT_KEY = "jobs:heartbeat";
const CLEANUP_KEY = "jobs:cleanup:last";

const sampleSchema = z.object({ at: z.string(), outPerSec: z.number() });
const cleanupSchema = z.object({ at: z.string(), accounts: z.number(), items: z.number() });
export type CleanupRun = z.infer<typeof cleanupSchema>;

/** Stores one outbound bandwidth sample and refreshes the worker heartbeat. */
export async function recordSample(outPerSec: number, at: Date): Promise<void> {
  const interval = getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC;
  await redis()
    .multi()
    .lpush(HISTORY_KEY, JSON.stringify({ at: at.toISOString(), outPerSec }))
    .ltrim(HISTORY_KEY, 0, METRICS.historySamples - 1)
    .set(HEARTBEAT_KEY, at.toISOString(), "EX", interval * METRICS.heartbeatMisses)
    .exec();
}

/** Bandwidth samples, oldest first. */
export async function readHistory(): Promise<{ at: string; outPerSec: number }[]> {
  try {
    const raw = await redis().lrange(HISTORY_KEY, 0, METRICS.historySamples - 1);
    return raw.flatMap((entry) => {
      const parsed = sampleSchema.safeParse(JSON.parse(entry));
      return parsed.success ? [parsed.data] : [];
    }).reverse();
  } catch {
    return [];
  }
}

/** True while the worker keeps sampling. */
export async function workerAlive(): Promise<boolean> {
  try {
    return (await redis().exists(HEARTBEAT_KEY)) === 1;
  } catch {
    return false;
  }
}

export async function recordCleanup(run: CleanupRun): Promise<void> {
  await redis().set(CLEANUP_KEY, JSON.stringify(run));
}

export async function lastCleanup(): Promise<CleanupRun | null> {
  try {
    const raw = await redis().get(CLEANUP_KEY);
    const parsed = raw ? cleanupSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}
