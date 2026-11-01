import "server-only";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { getAppEnv, getEnv } from "@/config/env";
import { NOTIFY } from "@/config/policy";
import { webhookRequest, type ArrivedFile, type NotifyEvent } from "@/domain/notify";
import { postWebhook, WebhookError } from "../http/webhook";
import { logger } from "../logger";
import { redis } from "../redis";
import { groupKeys, NOTIFY_QUEUE, type NotifyJob } from "./notify-queue";
import { queueConnection } from "./queue";

function parseFile(value: string): ArrivedFile | null {
  try {
    const file = JSON.parse(value) as Partial<ArrivedFile>;
    return typeof file.name === "string" && typeof file.size === "number" ? { name: file.name, size: file.size } : null;
  } catch {
    return null;
  }
}

/**
 * Takes the arrivals collected for a link (and closes the group in the same transaction, so a
 * later arrival opens a new one); null when nothing was collected.
 */
async function collectGroup(group: NonNullable<NotifyJob["group"]>): Promise<NotifyEvent | null> {
  const keys = groupKeys(group.requestId);
  const results = await redis().multi().lrange(keys.files, 0, -1).get(keys.count).get(keys.bytes).del(keys.files, keys.count, keys.bytes, keys.open).exec();
  if (!results) throw new Error("Redis transaction was aborted.");
  const failed = results.find(([error]) => error);
  if (failed?.[0]) throw failed[0];
  const [[, files], [, count], [, bytes]] = results as [[null, string[]], [null, string | null], [null, string | null]];
  const total = Number(count ?? 0);
  if (total === 0) return null;
  const listed = files.map(parseFile).filter((file): file is ArrivedFile => file !== null);
  return { kind: "file-request", owner: group.owner, request: group.request, files: listed, count: total, bytes: Number(bytes ?? 0) };
}

/**
 * One notification job: collects a link's arrivals on the first attempt (stored on the job, so a
 * retry sends the same message), then posts it in the configured format. A receiver that refuses
 * the request (4xx other than 408/429, a redirect) is not tried again.
 */
export async function processNotification(job: Job<NotifyJob>): Promise<"sent" | "empty" | "off"> {
  let event = job.data.event;
  if (!event && job.data.group) {
    const collected = await collectGroup(job.data.group);
    if (!collected) return "empty";
    event = collected;
    await job.updateData({ ...job.data, event });
  }
  if (!event) return "empty";
  const env = getEnv("notify");
  if (!env.NOTIFY_WEBHOOK_URL) {
    logger.warn("notification dropped: NOTIFY_WEBHOOK_URL is not set for the worker", { kind: event.kind });
    return "off";
  }
  const format = env.NOTIFY_WEBHOOK_FORMAT;
  const request = webhookRequest(event, { format, site: new URL(getAppEnv().PUBLIC_URL).origin, at: new Date(job.timestamp), maxChars: NOTIFY.maxChars[format], chatId: env.NOTIFY_TELEGRAM_CHAT_ID });
  try {
    await postWebhook({ url: env.NOTIFY_WEBHOOK_URL, token: env.NOTIFY_WEBHOOK_TOKEN, timeoutMs: NOTIFY.requestTimeoutMs }, request);
  } catch (error) {
    if (error instanceof WebhookError && !error.retryable) throw new UnrecoverableError(error.message);
    throw error;
  }
  return "sent";
}

/** The worker of the notify queue (npm run worker), one call at a time. */
export function startNotifyWorker(): Worker<NotifyJob> {
  const worker = new Worker<NotifyJob>(NOTIFY_QUEUE, processNotification, { ...queueConnection("worker"), concurrency: NOTIFY.workerConcurrency });
  // The message only: no URL, token or response body is ever part of it.
  worker.on("failed", (job, error) => logger.error("notification failed", { job: job?.name, attempts: job?.attemptsMade, error: error.message }));
  worker.on("error", (error) => logger.error("notify worker error", { error }));
  return worker;
}
