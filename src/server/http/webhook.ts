import "server-only";
import { retryableStatus, type WebhookRequest } from "@/domain/notify";

/** A webhook call that did not succeed; `retryable` says whether trying again can help. */
export class WebhookError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface WebhookTarget {
  url: string;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  timeoutMs: number;
}

const REDIRECT_MIN = 300;
const REDIRECT_MAX = 399;

/** A short, safe reason for a failed connection: an error code, never the URL (it may hold a bot token). */
function reasonOf(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timed out";
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : "connection failed";
}

/**
 * Posts one notification. Redirects are not followed (a webhook that moved, or one that points
 * the request at another host, is a setup error), the call gives up after `timeoutMs`, and the
 * response body is discarded unread: neither it nor the URL ends up in an error or a log.
 */
export async function postWebhook(target: WebhookTarget, request: WebhookRequest): Promise<void> {
  const headers: Record<string, string> = { ...request.headers };
  if (target.token) headers.authorization = `Bearer ${target.token}`;
  let response: Response;
  try {
    response = await fetch(target.url, { method: "POST", headers, body: request.body, redirect: "manual", signal: AbortSignal.timeout(target.timeoutMs) });
  } catch (error) {
    throw new WebhookError(`webhook not reached: ${reasonOf(error)}`, true);
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) return;
  if (response.status >= REDIRECT_MIN && response.status <= REDIRECT_MAX) {
    throw new WebhookError(`webhook answered with a redirect (${response.status}); set NOTIFY_WEBHOOK_URL to the final address`, false);
  }
  throw new WebhookError(`webhook answered ${response.status}`, retryableStatus(response.status));
}
