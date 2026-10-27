import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MS, SHARE } from "@/config/policy";
import { decodeSigned, encodeSigned } from "../auth/signed-cookie";

/**
 * `rf_sh` remembers which password-protected links this device unlocked, until when, and for
 * which password: each entry carries a tag of the link's password hash, so changing the
 * password locks out every device that opened it with the old one. It holds link ids, times
 * and tags only (never passwords) and is signed so it cannot be edited.
 */
export const UNLOCK_COOKIE = "rf_sh";
/** Links remembered at once; the oldest are dropped first. */
const MAX_LINKS = 50;
const SECOND = MS.second;
const HOUR_SECONDS = MS.hour / MS.second;
const PURPOSE = "share:";
/** Bytes of the password tag (64 bits: enough to tell passwords apart, too short to brute-force anything). */
const TAG_BYTES = 8;

/** v1 entries had no password tag; they are ignored, so those visitors enter the password once more. */
const payloadSchema = z.object({
  v: z.literal(2),
  u: z.array(z.tuple([z.string().max(32), z.number().int(), z.string().max(16)])).max(MAX_LINKS),
});

export interface Unlock {
  /** Epoch seconds. */
  until: number;
  tag: string;
}

export type Unlocks = Map<string, Unlock>;

/** Tag of a link's password hash (empty for links without a password). */
export function passwordTag(passwordHash: string | null, secret: string): string {
  return createHmac("sha256", secret)
    .update(`share-password:${passwordHash ?? ""}`)
    .digest()
    .subarray(0, TAG_BYTES)
    .toString("base64url");
}

/** Unlocked link ids with their expiry and tag; empty when missing, expired, tampered or v1. */
export function decodeUnlocks(raw: string | undefined, secrets: readonly string[], now: number): Unlocks {
  const result: Unlocks = new Map();
  const parsed = decodeSigned(raw, payloadSchema, secrets, PURPOSE);
  for (const [linkId, until, tag] of parsed?.u ?? []) if (until * SECOND > now) result.set(linkId, { until, tag });
  return result;
}

/** True when this device unlocked the link with its current password. */
export function isUnlocked(unlocks: Unlocks, linkId: string, passwordHash: string | null, secrets: readonly string[]): boolean {
  const entry = unlocks.get(linkId);
  if (!entry) return false;
  const given = Buffer.from(entry.tag);
  return secrets.some((secret) => {
    const expected = Buffer.from(passwordTag(passwordHash, secret));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** Adds links (each valid for SHARE.unlockHours, for its current password) and returns the new cookie value. */
export function unlocksWith(current: Unlocks, links: readonly { linkId: string; passwordHash: string | null }[], secret: string, now: number): string {
  const next = new Map(current);
  for (const { linkId, passwordHash } of links) {
    next.delete(linkId);
    next.set(linkId, { until: Math.floor(now / SECOND) + SHARE.unlockHours * HOUR_SECONDS, tag: passwordTag(passwordHash, secret) });
  }
  const entries = [...next.entries()].slice(-MAX_LINKS).map(([id, { until, tag }]) => [id, until, tag]);
  return encodeSigned({ v: 2, u: entries }, secret, PURPOSE);
}

/** Adds one link (valid for SHARE.unlockHours, for its current password) and returns the new cookie value. */
export function addUnlock(current: Unlocks, linkId: string, passwordHash: string | null, secret: string, now: number): string {
  return unlocksWith(current, [{ linkId, passwordHash }], secret, now);
}

export const UNLOCK_COOKIE_MAX_AGE = SHARE.unlockHours * HOUR_SECONDS;
