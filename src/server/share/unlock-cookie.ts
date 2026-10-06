import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MS, SHARE } from "@/config/policy";

/**
 * `rf_sh` remembers which password-protected links this device unlocked, until when. It
 * holds link ids and times only (never passwords) and is signed so it cannot be edited.
 */
export const UNLOCK_COOKIE = "rf_sh";
/** Links remembered at once; the oldest are dropped first. */
const MAX_LINKS = 50;
const SECOND = MS.second;
const HOUR_SECONDS = MS.hour / MS.second;

const payloadSchema = z.object({ v: z.literal(1), u: z.array(z.tuple([z.string().max(32), z.number().int()])).max(MAX_LINKS) });

export type Unlocks = Map<string, number>;

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`share:${payload}`).digest("base64url");

/** Unlocked link ids with their expiry (epoch seconds); empty when missing, expired or tampered. */
export function decodeUnlocks(raw: string | undefined, secrets: readonly string[], now: number): Unlocks {
  const result: Unlocks = new Map();
  if (!raw) return result;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return result;
  const given = Buffer.from(signature);
  const valid = secrets.some((secret) => {
    const expected = Buffer.from(sign(payload, secret));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return result;
  try {
    const parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    for (const [linkId, until] of parsed.u) if (until * SECOND > now) result.set(linkId, until);
  } catch {
    // Malformed: treat as nothing unlocked.
  }
  return result;
}

/** Adds a link (valid for SHARE.unlockHours) and returns the new cookie value. */
export function addUnlock(current: Unlocks, linkId: string, secret: string, now: number): string {
  const next = new Map(current);
  next.delete(linkId);
  next.set(linkId, Math.floor(now / SECOND) + SHARE.unlockHours * HOUR_SECONDS);
  const entries = [...next.entries()].slice(-MAX_LINKS);
  const payload = Buffer.from(JSON.stringify({ v: 1, u: entries })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export const UNLOCK_COOKIE_MAX_AGE = SHARE.unlockHours * HOUR_SECONDS;
