/**
 * Daily traffic limits of share links: a link (the shared item's own limit) and an account
 * (SHARE_DAILY_BYTES_CAP_GB for all its links together). Days are UTC calendar days.
 */

const DAY_MS = 86_400_000;
const MS_PER_SECOND = 1_000;
const BYTES_PER_GB = 1_000_000_000n;

/** Seconds until the next UTC midnight (at least 1), when the day's counters start over. */
export function secondsUntilUtcMidnight(now: number): number {
  const next = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  return Math.max(1, Math.ceil((next - now) / MS_PER_SECOND));
}

/** "2026-11-12": the UTC day a byte is counted on. */
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export interface CapUse {
  used: bigint;
  cap: bigint | null;
}

/**
 * Whether a new response may start: refused once the day's bytes reached a limit (checked before
 * sending, so one response can go past it). Returns which limit was reached, or null.
 */
export function capReached(link: CapUse, account: CapUse): "link" | "account" | null {
  if (link.cap !== null && link.used >= link.cap) return "link";
  if (account.cap !== null && account.used >= account.cap) return "account";
  return null;
}

/** Whole GB as bytes (decimal GB, like the storage sizes shown). */
export const gbToBytes = (gb: number) => BigInt(Math.round(gb * 1_000)) * (BYTES_PER_GB / 1_000n);

/** A limit in bytes as whole GB for the settings (null stays null). */
export const bytesToGb = (bytes: bigint | null) => (bytes === null ? null : Number(bytes / (BYTES_PER_GB / 1_000n)) / 1_000);
