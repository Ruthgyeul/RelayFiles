import "server-only";
import { AUTH } from "@/config/policy";
import { z } from "zod";
import { decodeSigned, encodeSigned } from "./signed-cookie";

/**
 * The `rf_s` cookie lists the sessions signed in on this device (one per account, so several
 * accounts can be signed in at once) and which one is active. It holds session ids only,
 * never tokens, and is signed so it cannot be edited. Revoked sessions are rejected by the
 * database lookup, so signing out on another device takes effect immediately.
 */
export const SESSION_COOKIE = "rf_s";
export const SESSION_COOKIE_MAX_AGE = AUTH.sessionCookieMaxAgeSec;
export const MAX_SESSIONS_PER_DEVICE = AUTH.maxSessionsPerDevice;

const payloadSchema = z.object({
  v: z.literal(1),
  s: z.array(z.string().min(16).max(64)).max(MAX_SESSIONS_PER_DEVICE),
  a: z.string().nullable(),
});

export type SessionCookie = { sessionIds: string[]; activeSessionId: string | null };

/** Signed without a purpose (it predates them); see signed-cookie.ts. */
const PURPOSE = "";

export function encodeSessionCookie(value: SessionCookie, secret: string): string {
  const ids = [...new Set(value.sessionIds)].slice(-MAX_SESSIONS_PER_DEVICE);
  const active = value.activeSessionId && ids.includes(value.activeSessionId) ? value.activeSessionId : (ids.at(-1) ?? null);
  return encodeSigned({ v: 1, s: ids, a: active }, secret, PURPOSE);
}

/** Returns the cookie contents, or an empty value when it is missing, tampered with or malformed. */
export function decodeSessionCookie(raw: string | undefined, secrets: readonly string[]): SessionCookie {
  const parsed = decodeSigned(raw, payloadSchema, secrets, PURPOSE);
  return parsed ? { sessionIds: parsed.s, activeSessionId: parsed.a } : { sessionIds: [], activeSessionId: null };
}
