import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The `rf_s` cookie lists the sessions signed in on this device (one per account, so several
 * accounts can be signed in at once) and which one is active. It holds session ids only,
 * never tokens, and is signed so it cannot be edited. Revoked sessions are rejected by the
 * database lookup, so signing out on another device takes effect immediately.
 */
export const SESSION_COOKIE = "rf_s";
/** One year; the sessions inside expire with their accounts. */
export const SESSION_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Upper bound on accounts signed in on one device. */
export const MAX_SESSIONS_PER_DEVICE = 10;

const payloadSchema = z.object({
  v: z.literal(1),
  s: z.array(z.string().min(16).max(64)).max(MAX_SESSIONS_PER_DEVICE),
  a: z.string().nullable(),
});

export type SessionCookie = { sessionIds: string[]; activeSessionId: string | null };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSessionCookie(value: SessionCookie, secret: string): string {
  const ids = [...new Set(value.sessionIds)].slice(-MAX_SESSIONS_PER_DEVICE);
  const active = value.activeSessionId && ids.includes(value.activeSessionId) ? value.activeSessionId : (ids.at(-1) ?? null);
  const payload = Buffer.from(JSON.stringify({ v: 1, s: ids, a: active })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the cookie contents, or an empty value when it is missing, tampered with or malformed. */
export function decodeSessionCookie(raw: string | undefined, secrets: readonly string[]): SessionCookie {
  const empty: SessionCookie = { sessionIds: [], activeSessionId: null };
  if (!raw) return empty;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return empty;
  const given = Buffer.from(signature);
  const valid = secrets.some((secret) => {
    const expected = Buffer.from(sign(payload, secret));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return empty;
  try {
    const parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return { sessionIds: parsed.s, activeSessionId: parsed.a };
  } catch {
    return empty;
  }
}
