import "server-only";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { fromAdminNetwork } from "./admin-network";
import { loadDeviceSession, type DeviceSession } from "./device-session";
import { SESSION_COOKIE } from "./session-cookie";

/** Device session for a route handler request. */
export function deviceOf(req: NextRequest): Promise<DeviceSession> {
  return loadDeviceSession(req.cookies.get(SESSION_COOKIE)?.value, fromAdminNetwork(req.headers));
}

/** Device session for server components and layouts (read-only: cookies cannot be written while rendering). */
export async function currentDevice(): Promise<DeviceSession> {
  return loadDeviceSession((await cookies()).get(SESSION_COOKIE)?.value, fromAdminNetwork(await headers()));
}

/** A percent-encoded cookie value; undefined when the encoding is broken (a forged header, not a server error). */
function decodeCookieValue(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** Device session for a plain Request (tus upload hooks), read from the Cookie header. */
export function deviceOfRequest(req: Request): Promise<DeviceSession> {
  const cookie = req.headers.get("cookie") ?? "";
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return loadDeviceSession(entry ? decodeCookieValue(entry.slice(SESSION_COOKIE.length + 1)) : undefined, fromAdminNetwork(req.headers));
}
