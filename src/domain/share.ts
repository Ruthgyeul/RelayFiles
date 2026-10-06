/**
 * Share setting rules from the design: expiry choices (`EXPIRY`, `EXP_MS`) and how a
 * saved choice turns into a deletion time.
 */

export const EXPIRY_OPTIONS = ["5 min", "1 hour", "1 day", "7 days", "30 days", "Never"] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

export const EXPIRY_MS: Record<Exclude<ExpiryOption, "Never">, number> = {
  "5 min": 300_000,
  "1 hour": 3_600_000,
  "1 day": 86_400_000,
  "7 days": 604_800_000,
  "30 days": 2_592_000_000,
};

export function isExpiryOption(value: string): value is ExpiryOption {
  return (EXPIRY_OPTIONS as readonly string[]).includes(value);
}

/**
 * Deletion time after saving: a new choice starts counting now, an unchanged choice keeps
 * its time, "Never" clears it (design `saveSettings`).
 */
export function nextExpiry(previous: { expiry: string; expAt: number | null }, chosen: ExpiryOption, now: number): number | null {
  if (chosen === "Never") return null;
  if (chosen === previous.expiry && previous.expAt) return previous.expAt;
  return now + EXPIRY_MS[chosen];
}

/** Longest share password accepted (argon2 hashes any length; this bounds request size). */
export const MAX_SHARE_PASSWORD_LENGTH = 128;
/** Longest note shown on a share page. */
export const MAX_SHARE_NOTE_LENGTH = 2_000;
/** Most downloads a link can be limited to. */
export const MAX_DOWNLOAD_LIMIT = 1_000_000;
