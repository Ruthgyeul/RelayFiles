import type { NextRequest } from "next/server";
import { METRICS } from "@/config/policy";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { ApiError } from "@/server/http/api-error";
import { apiHandler } from "@/server/http/api-handler";
import { logger } from "@/server/logger";
import { serverSnapshot } from "@/server/services/server-metrics.service";

/** Open Server page streams per account in this process (each one samples the server every tick). */
const globalForStreams = globalThis as unknown as { relayAdminStreams?: Map<string, number> };
const openStreams = (globalForStreams.relayAdminStreams ??= new Map<string, number>());

/** Whether the request's session still belongs to an admin (signed out, demoted or out of range ends the stream). */
async function stillAdmin(req: NextRequest): Promise<boolean> {
  try {
    requireAdmin(await deviceOf(req));
    return true;
  } catch {
    return false;
  }
}

/**
 * Live Server page metrics as Server-Sent Events, one snapshot every 1.5 s until the page
 * closes. The session is checked again every METRICS.streamSessionCheckMs, a stream lasts at
 * most METRICS.streamMaxLifetimeMs (EventSource reconnects through the same checks), and an
 * account holds at most METRICS.streamMaxPerAccount at once.
 */
export const GET = apiHandler<Response>(async ({ req }) => {
  const admin = requireAdmin(await deviceOf(req));
  const accountId = admin.account.id;
  if ((openStreams.get(accountId) ?? 0) >= METRICS.streamMaxPerAccount) throw new ApiError("RATE_LIMITED", "Too many open Server pages.");
  openStreams.set(accountId, (openStreams.get(accountId) ?? 0) + 1);

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let lastCheck = startedAt;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  // One snapshot at a time: a slow one (smartctl, a busy disk) skips ticks instead of piling up.
  let sending = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    const left = (openStreams.get(accountId) ?? 1) - 1;
    if (left > 0) openStreams.set(accountId, left);
    else openStreams.delete(accountId);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const end = () => {
        if (closed) return;
        stop();
        // The stream may already be cancelled; closing it again must not throw from the listener.
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      const send = async () => {
        if (closed || sending) return;
        sending = true;
        try {
          const now = Date.now();
          if (now - startedAt >= METRICS.streamMaxLifetimeMs) return end();
          if (now - lastCheck >= METRICS.streamSessionCheckMs) {
            lastCheck = now;
            if (!(await stillAdmin(req))) return end();
          }
          const snapshot = await serverSnapshot();
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
        } catch (error) {
          logger.warn("server metrics not sent", { error });
        } finally {
          sending = false;
        }
      };
      void send();
      timer = setInterval(() => void send(), METRICS.streamIntervalMs);
      req.signal.addEventListener("abort", end, { once: true });
    },
    cancel: stop,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
});
