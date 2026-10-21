import { METRICS } from "@/config/policy";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { logger } from "@/server/logger";
import { serverSnapshot } from "@/server/services/server-metrics.service";

/** Live Server page metrics as Server-Sent Events, one snapshot every 1.5 s until the page closes. */
export const GET = apiHandler<Response>(async ({ req }) => {
  requireAdmin(await deviceOf(req));
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  // One snapshot at a time: a slow one (smartctl, a busy disk) skips ticks instead of piling up.
  let sending = false;
  const stop = () => {
    closed = true;
    clearInterval(timer);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = async () => {
        if (closed || sending) return;
        sending = true;
        try {
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
      req.signal.addEventListener(
        "abort",
        () => {
          if (closed) return;
          stop();
          // The stream may already be cancelled; closing it again must not throw from the listener.
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        },
        { once: true },
      );
    },
    cancel: stop,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
});
