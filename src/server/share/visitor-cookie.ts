import "server-only";
import { randomBytes } from "node:crypto";
import { getAppEnv } from "@/config/env";
import { MS, SHARE } from "@/config/policy";

/**
 * `rf_dv` tells one share visitor's browser apart from another's: a random id, nothing else.
 * A counted download start is granted to it (`download-grant.ts`), so resuming works for that
 * browser only; an IP would let everyone behind the same NAT read the file uncounted.
 */
export const VISITOR_COOKIE = "rf_dv";
const ID_BYTES = 16;
const ID_PATTERN = /^[0-9a-f]{32}$/;
const MAX_AGE_SEC = (SHARE.downloadGrantHours * MS.hour) / MS.second;

/** The visitor id from the cookie value, or null when missing or malformed. */
export function visitorIdOf(raw: string | undefined): string | null {
  return raw && ID_PATTERN.test(raw) ? raw : null;
}

export function newVisitorId(): string {
  return randomBytes(ID_BYTES).toString("hex");
}

/** Adds the visitor cookie to a response (only share APIs read it). */
export function setVisitorCookie(response: Response, visitorId: string): Response {
  const secure = getAppEnv().PUBLIC_URL.startsWith("https:") ? "; Secure" : "";
  response.headers.append("set-cookie", `${VISITOR_COOKIE}=${visitorId}; Path=/api/share; Max-Age=${MAX_AGE_SEC}; HttpOnly; SameSite=Lax${secure}`);
  return response;
}
