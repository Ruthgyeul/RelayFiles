import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { cookieSecrets } from "../auth/keys";
import { currentDevice, deviceOf } from "../auth/current";
import type { DeviceSession } from "../auth/device-session";
import type { ShareViewer } from "./share.service";
import { decodeUnlocks, UNLOCK_COOKIE } from "./unlock-cookie";
import { VISITOR_COOKIE, visitorIdOf } from "./visitor-cookie";

const viewerOf = (device: DeviceSession, unlockCookie: string | undefined, visitorCookie: string | undefined, now: number): ShareViewer => ({
  accountIds: device.accounts.map((entry) => entry.account.id),
  unlocks: decodeUnlocks(unlockCookie, cookieSecrets(), now),
  visitorId: visitorIdOf(visitorCookie),
});

/** The visitor of a share route handler. */
export async function shareViewerOf(req: NextRequest, now: number): Promise<ShareViewer> {
  return viewerOf(await deviceOf(req), req.cookies.get(UNLOCK_COOKIE)?.value, req.cookies.get(VISITOR_COOKIE)?.value, now);
}

/** The visitor of the share page (server component). */
export async function currentShareViewer(now: number): Promise<ShareViewer> {
  const jar = await cookies();
  return viewerOf(await currentDevice(), jar.get(UNLOCK_COOKIE)?.value, jar.get(VISITOR_COOKIE)?.value, now);
}
