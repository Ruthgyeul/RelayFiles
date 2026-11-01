import "server-only";
import { Queue } from "bullmq";
import { getEnv } from "@/config/env";
import { JOBS, MS, NOTIFY } from "@/config/policy";
import type { ArrivedFile, NotifyEvent } from "@/domain/notify";
import { logger } from "../logger";
import { redis } from "../redis";
import { queueConnection } from "./queue";

/**
 * Owner notifications (docs/runbook.md "알림 설정"): the app, the worker's probes and scripts
 * only put jobs on the `notify` queue; the worker makes the webhook call (jobs/notify-worker.ts)
 * with retries, so a slow or unreachable receiver never holds up an upload or a probe.
 */
export const NOTIFY_QUEUE = "notify";

/** A ready event, or a group of upload-only link arrivals the worker collects when it runs. */
export interface NotifyJob {
  event?: NotifyEvent;
  group?: { requestId: string; owner: string; request: string };
}

/** True when NOTIFY_WEBHOOK_URL is set; nothing is queued otherwise. */
export function notifyEnabled(): boolean {
  return getEnv("notify").NOTIFY_WEBHOOK_URL !== undefined;
}

const globalForNotify = globalThis as unknown as { relayNotifyQueue?: Queue<NotifyJob> };

export function notifyQueue(): Queue<NotifyJob> {
  globalForNotify.relayNotifyQueue ??= new Queue<NotifyJob>(NOTIFY_QUEUE, {
    ...queueConnection("producer"),
    defaultJobOptions: {
      attempts: NOTIFY.jobAttempts,
      backoff: { type: "exponential", delay: NOTIFY.jobBackoffMs },
      // Bounded history like the other queues; a kept job also makes its id a no-op when added again.
      removeOnComplete: { count: JOBS.keepCompleted },
      removeOnFail: { count: JOBS.keepFailed },
    },
  });
  return globalForNotify.relayNotifyQueue;
}

export async function closeNotifyQueue(): Promise<void> {
  await globalForNotify.relayNotifyQueue?.close();
  globalForNotify.relayNotifyQueue = undefined;
}

/** Redis keys of one link's pending arrivals (REDIS_KEY_PREFIX is added by the client). */
export function groupKeys(requestId: string) {
  const base = `notify:fr:${requestId}`;
  return { files: `${base}:files`, count: `${base}:count`, bytes: `${base}:bytes`, open: `${base}:open` };
}

/**
 * Queues one event. `jobId` makes it idempotent: the same id while the job is pending or kept
 * in the history is ignored. Never throws: a notification is never worth failing the caller.
 */
export async function queueNotification(event: NotifyEvent, jobId: string): Promise<void> {
  if (!notifyEnabled()) return;
  try {
    await notifyQueue().add(event.kind, { event }, { jobId });
  } catch (error) {
    logger.warn("notification not queued", { kind: event.kind, error });
  }
}

/**
 * Queues an alert at most once per `windowMs` for the same kind and subject (a volume stays low
 * for hours; the watch sees it every 30 seconds). The window starts with the alert that is sent.
 */
export async function queueThrottled(event: NotifyEvent, subject: string, windowMs: number): Promise<boolean> {
  if (!notifyEnabled()) return false;
  try {
    const first = await redis().set(`notify:throttle:${event.kind}:${subject}`, "1", "PX", windowMs, "NX");
    if (first !== "OK") return false;
    await queueNotification(event, `${event.kind}-${subject}-${Date.now()}`);
    return true;
  } catch (error) {
    logger.warn("notification not queued", { kind: event.kind, error });
    return false;
  }
}

/** How long an alert kind is held back after it was sent (NOTIFY policy). */
export const THROTTLE_MS = {
  "volume-low": NOTIFY.volumeLowRepeatHours * MS.hour,
  "volume-readonly": NOTIFY.volumeReadOnlyRepeatHours * MS.hour,
  "volume-offline": NOTIFY.volumeStatusRepeatMinutes * MS.minute,
  "volume-online": NOTIFY.volumeStatusRepeatMinutes * MS.minute,
};

export interface RequestArrival {
  requestId: string;
  /** Name of the account that owns the link, and the link's title. */
  owner: string;
  request: string;
  file: ArrivedFile;
}

/**
 * Notes a file that arrived through an upload-only link. Arrivals within
 * NOTIFY.fileRequestGroupSec of the first are collected in Redis (the first fileRequestListMax
 * names, plus the count and bytes of all) and sent as one message by a delayed job; the first
 * arrival of a group queues that job. One transaction, so an arrival is either in the group the
 * worker collects or opens the next one. Never throws.
 */
export async function noteRequestArrival(arrival: RequestArrival): Promise<void> {
  if (!notifyEnabled()) return;
  const keys = groupKeys(arrival.requestId);
  const ttl = NOTIFY.stateTtlSec;
  try {
    const results = await redis()
      .multi()
      .rpush(keys.files, JSON.stringify(arrival.file))
      .ltrim(keys.files, 0, NOTIFY.fileRequestListMax - 1)
      .expire(keys.files, ttl)
      .incr(keys.count)
      .expire(keys.count, ttl)
      .incrby(keys.bytes, arrival.file.size)
      .expire(keys.bytes, ttl)
      .set(keys.open, "1", "EX", ttl, "NX")
      .exec();
    const [error, opened] = results?.at(-1) ?? [new Error("Redis transaction was aborted."), null];
    if (error) throw error;
    if (opened !== "OK") return;
    const group = { requestId: arrival.requestId, owner: arrival.owner, request: arrival.request };
    try {
      await notifyQueue().add("file-request", { group }, { jobId: `file-request-${arrival.requestId}-${Date.now()}`, delay: NOTIFY.fileRequestGroupSec * MS.second });
    } catch (queueError) {
      // Without its job the open group would hold back this link's notifications for a day.
      await redis().del(keys.open);
      throw queueError;
    }
  } catch (error) {
    logger.warn("notification not queued", { kind: "file-request", error });
  }
}
