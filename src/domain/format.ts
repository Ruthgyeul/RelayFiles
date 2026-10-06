/**
 * Display formatting ported from the design prototype. Output strings must match the
 * design exactly, so each function mirrors its prototype counterpart.
 */

/** Clock time "m:ss" or "h:mm:ss" (prototype `fmtT`), floor of the seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
}

/** Countdown text: rounds up so "0:00" only shows once the wait is over (prototype `lockText`). */
export function formatCountdown(seconds: number): string {
  return formatClock(Math.ceil(Math.max(0, seconds)));
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const SIZE_STEP = 1000;

/** Decimal sizes like the design (`fmtSize`): "512 B", "2.4 GB", "18 GB". */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= SIZE_STEP && unit < SIZE_UNITS.length - 1) {
    value /= SIZE_STEP;
    unit++;
  }
  return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${SIZE_UNITS[unit]}`;
}

/** Remaining time like the design (`fmtLeft`): "2d 4h", "3h 12m", "5m", "now". */
export function formatLeft(ms: number): string {
  if (ms <= 0) return "now";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

/** Short date like "Oct 19" (sidebar "Deletes Oct 19", banners). Rendered in the viewer's time zone. */
export function formatShortDate(date: Date | string | number): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Date and time like the design (`fmtDate`): "Oct 5, 2026, 3:12 PM". */
export function formatDateTime(date: Date | string | number): string {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
