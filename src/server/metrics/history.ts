import "server-only";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { METRICS, MS } from "@/config/policy";
import { redis } from "../redis";

/** Written by the worker; read by the Server page. Redis holds only what can be measured again. */
const HISTORY_KEY = "metrics:net-out";
const DISK_KEY = "metrics:disk-io";
const HEARTBEAT_KEY = "jobs:heartbeat";
const CLEANUP_KEY = "jobs:cleanup:last";

const sampleSchema = z.object({ at: z.string(), outPerSec: z.number() });
const diskRateSchema = z.object({ name: z.string(), readPerSec: z.number(), writePerSec: z.number() });
const diskSampleSchema = z.object({ at: z.string(), disks: z.array(diskRateSchema) });
const cleanupSchema = z.object({ at: z.string(), accounts: z.number(), items: z.number() });
export type DiskRate = z.infer<typeof diskRateSchema>;
export type CleanupRun = z.infer<typeof cleanupSchema>;

/** Samples kept per list: METRICS.historyHours at one sample per METRICS_SAMPLE_INTERVAL_SEC. */
function historyLength(): number {
  return Math.ceil((METRICS.historyHours * MS.hour) / (getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC * MS.second));
}

/** Stores one outbound bandwidth and disk read/write sample and refreshes the worker heartbeat. */
export async function recordSample(sample: { outPerSec: number; disks: DiskRate[] }, at: Date): Promise<void> {
  const interval = getEnv("jobs").METRICS_SAMPLE_INTERVAL_SEC;
  const length = historyLength();
  const tx = redis()
    .multi()
    .lpush(HISTORY_KEY, JSON.stringify({ at: at.toISOString(), outPerSec: sample.outPerSec }))
    .ltrim(HISTORY_KEY, 0, length - 1);
  // The first sample after a worker start only primes the disk counters.
  if (sample.disks.length > 0) tx.lpush(DISK_KEY, JSON.stringify({ at: at.toISOString(), disks: sample.disks })).ltrim(DISK_KEY, 0, length - 1);
  await tx.set(HEARTBEAT_KEY, at.toISOString(), "EX", interval * METRICS.heartbeatMisses).exec();
}

/** Entries of a sample list that still match their schema, oldest first; none when Redis is down. */
async function readSamples<T>(key: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    const raw = await redis().lrange(key, 0, historyLength() - 1);
    return raw
      .flatMap((entry) => {
        const parsed = schema.safeParse(JSON.parse(entry));
        return parsed.success ? [parsed.data] : [];
      })
      .reverse();
  } catch {
    return [];
  }
}

/** Bandwidth samples, oldest first. */
export const readHistory = () => readSamples(HISTORY_KEY, sampleSchema);

/** Disk read/write samples, oldest first. */
export const readDiskHistory = () => readSamples(DISK_KEY, diskSampleSchema);

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
