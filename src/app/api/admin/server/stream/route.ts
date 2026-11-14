import type { NextRequest } from "next/server";
import { METRICS } from "@/config/policy";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { sseResponse } from "@/server/http/sse";
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
export const GET = apiHandler<Response>({ auth: "admin" }, async ({ req, active: admin }) =>
  sseResponse({
    req,
    open: openStreams,
    accountId: admin.account.id,
    maxPerAccount: METRICS.streamMaxPerAccount,
    busyMessage: "Too many open Server pages.",
    maxLifetimeMs: METRICS.streamMaxLifetimeMs,
    sessionCheckMs: METRICS.streamSessionCheckMs,
    stillAllowed: () => stillAdmin(req),
    start: (channel) => {
      // One snapshot at a time: a slow one (smartctl, a busy disk) skips ticks instead of piling up.
      let sending = false;
      const send = async () => {
        if (channel.closed || sending) return;
        sending = true;
        try {
          const snapshot = await serverSnapshot();
          channel.send(JSON.stringify(snapshot));
        } catch (error) {
          logger.warn("server metrics not sent", { error });
        } finally {
          sending = false;
        }
      };
      void send();
      const timer = setInterval(() => void send(), METRICS.streamIntervalMs);
      return () => clearInterval(timer);
    },
  }),
);
