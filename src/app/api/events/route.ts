import type { NextRequest } from "next/server";
import { LIVE } from "@/config/policy";
import { deviceOf } from "@/server/auth/current";
import { subscribeAccount } from "@/server/events/account-events";
import { apiHandler } from "@/server/http/api-handler";
import { sseResponse } from "@/server/http/sse";

/** Open file-list streams per account in this process. */
const globalForStreams = globalThis as unknown as { relayEventStreams?: Map<string, number> };
const openStreams = (globalForStreams.relayEventStreams ??= new Map<string, number>());

/** Whether the request's device still has this account signed in. */
async function stillSignedIn(req: NextRequest, accountId: string): Promise<boolean> {
  try {
    return (await deviceOf(req)).active?.account.id === accountId;
  } catch {
    return false;
  }
}

/**
 * "Your files changed" as Server-Sent Events, for the open pages of the active account: a
 * `changed` event (no content) at most every LIVE.coalesceMs after an upload, move, rename,
 * delete, setting change or finished thumbnail anywhere (another device, WebDAV, the CLI, the
 * worker). The page then reloads what it shows through its usual requests.
 */
export const GET = apiHandler<Response>({ auth: "active" }, async ({ req, active: { account } }) =>
  sseResponse({
    req,
    open: openStreams,
    accountId: account.id,
    maxPerAccount: LIVE.maxPerAccount,
    busyMessage: "Too many open pages of this account.",
    maxLifetimeMs: LIVE.maxLifetimeMs,
    sessionCheckMs: LIVE.sessionCheckMs,
    stillAllowed: () => stillSignedIn(req, account.id),
    start: async (channel) => {
      // Changes arriving together (a folder of uploads) become one event.
      let pending: ReturnType<typeof setTimeout> | undefined;
      const stop = await subscribeAccount(account.id, () => {
        pending ??= setTimeout(() => {
          pending = undefined;
          channel.send("changed");
        }, LIVE.coalesceMs);
      });
      const heartbeat = setInterval(channel.comment, LIVE.heartbeatMs);
      // The first comment tells the browser the stream is open.
      channel.comment();
      return () => {
        clearTimeout(pending);
        clearInterval(heartbeat);
        void stop();
      };
    },
  }),
);
