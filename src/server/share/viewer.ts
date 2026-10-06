import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { cookieSecrets } from "../auth/keys";
import { currentDevice, deviceOf } from "../auth/current";
import type { DeviceSession } from "../auth/device-session";
import type { ShareViewer } from "../services/share.service";
import { decodeUnlocks, UNLOCK_COOKIE } from "./unlock-cookie";

const viewerOf = (device: DeviceSession, unlockCookie: string | undefined, now: number): ShareViewer => ({
  accountIds: device.accounts.map((entry) => entry.account.id),
  unlocks: decodeUnlocks(unlockCookie, cookieSecrets(), now),
});

/** The visitor of a share route handler. */
export async function shareViewerOf(req: NextRequest, now: number): Promise<ShareViewer> {
  return viewerOf(await deviceOf(req), req.cookies.get(UNLOCK_COOKIE)?.value, now);
}

/** The visitor of the share page (server component). */
export async function currentShareViewer(now: number): Promise<ShareViewer> {
  return viewerOf(await currentDevice(), (await cookies()).get(UNLOCK_COOKIE)?.value, now);
}
