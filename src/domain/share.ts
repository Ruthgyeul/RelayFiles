import { formatLeft } from "./format";

/**
 * Share setting rules from the design: expiry choices (`EXPIRY`, `EXP_MS`), how a saved
 * choice turns into a deletion time, and what a share page shows (state, busy level).
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

// ---------------------------------------------------------------- share page rules

export type ShareStatus = "expired" | "blocked" | "private" | "locked" | "open";

export interface LinkFacts {
  /** Epoch ms of deletion, if the link expires. */
  expAt: number | null;
  burn: boolean;
  downloads: number;
  downloadLimit: number | null;
  effectiveVisibility: "private" | "public";
  hasPassword: boolean;
  /** This device entered the password. */
  unlocked: boolean;
}

/** True when a download limit is set and used up (design `limitHit`). */
export function limitHit(downloadLimit: number | null, downloads: number): boolean {
  return downloadLimit !== null && downloadLimit > 0 && downloads >= downloadLimit;
}

/**
 * What a share link shows, in the design's order: expired (past its time, or a
 * delete-after-download link that was used), download limit reached, private, password, open.
 */
export function shareStatus(link: LinkFacts, now: number): ShareStatus {
  if ((link.expAt !== null && now >= link.expAt) || (link.burn && link.downloads >= 1)) return "expired";
  if (limitHit(link.downloadLimit, link.downloads)) return "blocked";
  if (link.effectiveVisibility !== "public") return "private";
  if (link.hasPassword && !link.unlocked) return "locked";
  return "open";
}

export interface BusyThresholds {
  windowMs: number;
  throttleAt: number;
  pauseAt: number;
}

export interface Busy {
  /** 0 normal, 1 throttled, 2 downloads paused. */
  level: 0 | 1 | 2;
  /** Downloads in the window. */
  count: number;
  /** When a "Server busy" pause ends (epoch ms). */
  until: number | null;
  /** Paused by an admin rather than by traffic. */
  manual: boolean;
}

/** Busy level from recent download times (design `busyOf`). */
export function busyOf(downloadTimes: readonly number[], paused: boolean, now: number, limits: BusyThresholds): Busy {
  const recent = downloadTimes.filter((at) => now - at < limits.windowMs).sort((a, b) => b - a);
  const count = recent.length;
  if (paused) return { level: 2, count, until: null, manual: true };
  if (count >= limits.pauseAt) return { level: 2, count, until: recent[limits.pauseAt - 1]! + limits.windowMs, manual: false };
  if (count >= limits.throttleAt) return { level: 1, count, until: null, manual: false };
  return { level: 0, count, until: null, manual: false };
}

export interface BusyBadge {
  level: 1 | 2;
  label: string;
  tip: string;
}

/** Badge text for the File Manager (`app`) and the share page (`share`) (design `busyVals`). */
export function busyBadge(busy: Busy, now: number, place: "app" | "share"): BusyBadge | null {
  if (busy.level === 0) return null;
  const left = busy.until ? formatLeft(busy.until - now) : "";
  if (busy.level === 2) {
    if (busy.manual) return { level: 2, label: "Downloads paused", tip: "Downloads paused by the admin" };
    return {
      level: 2,
      label: place === "app" ? "Server busy" : `Server busy · retry in ${left}`,
      tip: `${busy.count} downloads in the last 10 min · downloads paused for ${left}`,
    };
  }
  return { level: 1, label: place === "app" ? "Busy" : "Busy · slower downloads", tip: `${busy.count} downloads in the last 10 min · downloads are throttled` };
}

/** Second line of a share page row: "12 MB · Video" (design `meta`). */
export const KIND_LABEL = { video: "Video", audio: "Audio", image: "Image", other: "File" } as const;
