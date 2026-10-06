/**
 * Storage quota rules from the design: the sidebar meter color and the quota banners.
 * Sizes are numbers of bytes; null quota means unlimited (admins).
 */

/** Banner thresholds (percent of quota). */
/** Storage sizes are decimal like the design (1 GB = 10^9 bytes). */
export const BYTES_PER_GB = 1_000_000_000;

export const QUOTA_WARN_PERCENT = 80;
export const QUOTA_FULL_PERCENT = 95;
/** Meter color thresholds (percent of quota). */
const METER_DANGER_PERCENT = 90;
const METER_WARN_PERCENT = 70;
/** Width of the meter for unlimited accounts and the minimum visible width. */
const UNLIMITED_METER_PERCENT = 2;
const MIN_METER_PERCENT = 1;

export function usedPercent(used: number, quota: number | null): number {
  if (quota === null || quota <= 0) return 0;
  return (used / quota) * 100;
}

/** 0 = fine, 1 = "Storage almost full" (≥80%), 2 = "Storage is full" (≥95%). */
export function quotaLevel(used: number, quota: number | null): 0 | 1 | 2 {
  if (quota === null) return 0;
  const percent = usedPercent(used, quota);
  if (percent >= QUOTA_FULL_PERCENT) return 2;
  if (percent >= QUOTA_WARN_PERCENT) return 1;
  return 0;
}

/** Sidebar meter: width in percent and tone (`quotaPct`, `quotaColor` in the design). */
export function quotaMeter(used: number, quota: number | null): { percent: number; tone: "accent" | "warn" | "danger" } {
  if (quota === null) return { percent: UNLIMITED_METER_PERCENT, tone: "accent" };
  const percent = Math.min(100, usedPercent(used, quota));
  const tone = percent >= METER_DANGER_PERCENT ? "danger" : percent >= METER_WARN_PERCENT ? "warn" : "accent";
  return { percent: Math.max(percent, MIN_METER_PERCENT), tone };
}
