import "server-only";
import type { NextRequest } from "next/server";
import { ApiError } from "./api-error";

export interface SseChannel {
  /** Sends one `data:` event. */
  send(data: string): void;
  /** Sends a comment line (keeps proxies and tunnels from closing an idle stream). */
  comment(): void;
  /** Ends the stream (the browser's EventSource reconnects through the same checks). */
  end(): void;
  readonly closed: boolean;
}

export interface SseOptions {
  req: NextRequest;
  /** Open streams per account in this process (a module-level map of the route). */
  open: Map<string, number>;
  accountId: string;
  maxPerAccount: number;
  /** Message of the 429 when the account holds `maxPerAccount` streams. */
  busyMessage: string;
  maxLifetimeMs: number;
  sessionCheckMs: number;
  /** Whether the request's session may still read the stream (signed out or demoted ends it). */
  stillAllowed: () => Promise<boolean>;
  /** Starts sending; returns what to clean up when the stream ends. */
  start: (channel: SseChannel) => (() => void) | Promise<() => void>;
}

/**
 * A Server-Sent Events response with the limits every stream of the app shares: at most
 * `maxPerAccount` at once per account and process, the session read again every
 * `sessionCheckMs`, and an end after `maxLifetimeMs`. Nginx passes it unbuffered (X-Accel-Buffering).
 */
export function sseResponse(options: SseOptions): Response {
  const { req, open, accountId } = options;
  if ((open.get(accountId) ?? 0) >= options.maxPerAccount) throw new ApiError("RATE_LIMITED", options.busyMessage);
  open.set(accountId, (open.get(accountId) ?? 0) + 1);

  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (() => void) | null = null;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let sessionCheck: ReturnType<typeof setInterval> | undefined;
  const release = () => {
    if (closed) return;
    closed = true;
    clearTimeout(lifetime);
    clearInterval(sessionCheck);
    cleanup?.();
    const left = (open.get(accountId) ?? 1) - 1;
    if (left > 0) open.set(accountId, left);
    else open.delete(accountId);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The reader went away between the check and the write.
        }
      };
      const channel: SseChannel = {
        send: (data) => write(`data: ${data}\n\n`),
        comment: () => write(":\n\n"),
        end: () => {
          if (closed) return;
          release();
          // The stream may already be cancelled; closing it again must not throw.
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        },
        get closed() {
          return closed;
        },
      };
      req.signal.addEventListener("abort", channel.end, { once: true });
      lifetime = setTimeout(channel.end, options.maxLifetimeMs);
      sessionCheck = setInterval(() => {
        void options.stillAllowed().then((allowed) => allowed || channel.end());
      }, options.sessionCheckMs);
      const stop = await options.start(channel);
      // Ended while it was starting: clean up at once.
      if (closed) stop();
      else cleanup = stop;
    },
    cancel: release,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
}
