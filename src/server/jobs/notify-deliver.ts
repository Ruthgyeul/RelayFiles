import "server-only";
import { getAppEnv, getEnv } from "@/config/env";
import { NOTIFY } from "@/config/policy";
import { webhookRequest, type NotifyEvent } from "@/domain/notify";
import { postWebhook } from "../http/webhook";
import { logger } from "../logger";

/**
 * Posts one event to NOTIFY_WEBHOOK_URL in its configured format: the notify worker's last step,
 * and the app's own path for the one alert the worker cannot send (it stopped). Throws
 * WebhookError when the receiver fails; "off" when no webhook is set.
 */
export async function deliverNotification(event: NotifyEvent, at: Date): Promise<"sent" | "off"> {
  const env = getEnv("notify");
  if (!env.NOTIFY_WEBHOOK_URL) {
    logger.warn("notification dropped: NOTIFY_WEBHOOK_URL is not set", { kind: event.kind });
    return "off";
  }
  const format = env.NOTIFY_WEBHOOK_FORMAT;
  const request = webhookRequest(event, { format, site: new URL(getAppEnv().PUBLIC_URL).origin, at, maxChars: NOTIFY.maxChars[format], chatId: env.NOTIFY_TELEGRAM_CHAT_ID });
  await postWebhook({ url: env.NOTIFY_WEBHOOK_URL, token: env.NOTIFY_WEBHOOK_TOKEN, timeoutMs: NOTIFY.requestTimeoutMs }, request);
  return "sent";
}
