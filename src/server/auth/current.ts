import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { loadDeviceSession, type DeviceSession } from "./device-session";
import { SESSION_COOKIE } from "./session-cookie";

/** Device session for a route handler request. */
export function deviceOf(req: NextRequest): Promise<DeviceSession> {
  return loadDeviceSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Device session for server components and layouts (read-only: cookies cannot be written while rendering). */
export async function currentDevice(): Promise<DeviceSession> {
  return loadDeviceSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Device session for a plain Request (tus upload hooks), read from the Cookie header. */
export function deviceOfRequest(req: Request): Promise<DeviceSession> {
  const cookie = req.headers.get("cookie") ?? "";
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return loadDeviceSession(entry ? decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1)) : undefined);
}
