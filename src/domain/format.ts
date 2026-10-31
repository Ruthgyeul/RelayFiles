import { METRICS, MS } from "@/config/policy";

/**
 * Display formatting from the design. Output strings must match the
 * design exactly, so each function mirrors its prototype counterpart.
 */

/** Clock time "m:ss" or "h:mm:ss", floor of the seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
}

/** Countdown text: rounds up so "0:00" only shows once the wait is over. */
export function formatCountdown(seconds: number): string {
  return formatClock(Math.ceil(Math.max(0, seconds)));
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const SIZE_STEP = 1000;

/** Decimal sizes like the design: "512 B", "2.4 GB", "18 GB". */
export function formatSize(bytes: number): string {
  // Rates (bytes/s averages) are fractional; bytes are shown whole.
  let value = Math.round(bytes);
  let unit = 0;
  while (value >= SIZE_STEP && unit < SIZE_UNITS.length - 1) {
    value /= SIZE_STEP;
    unit++;
  }
  return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${SIZE_UNITS[unit]}`;
}

/** Rounds to at most `places` decimals (10.2149 → 10.21, 3.5 → 3.5). */
export function roundDecimals(value: number, places: number = METRICS.decimalPlaces): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Measured sizes and rates (Server page): decimal units with at most METRICS.decimalPlaces decimals, "10.21 MB". */
export function formatMetricSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (roundDecimals(value) >= SIZE_STEP && unit < SIZE_UNITS.length - 1) {
    value /= SIZE_STEP;
    unit++;
  }
  return `${roundDecimals(value)} ${SIZE_UNITS[unit]}`;
}

/** A measured percentage with at most METRICS.decimalPlaces decimals, "89.34%". */
export function formatPercent(percent: number): string {
  return `${roundDecimals(percent)}%`;
}

/** Remaining time like the design: "2d 4h", "3h 12m", "5m", "now". */
export function formatLeft(ms: number): string {
  if (ms <= 0) return "now";
  const days = Math.floor(ms / MS.day);
  const hours = Math.floor((ms % MS.day) / MS.hour);
  const minutes = Math.floor((ms % MS.hour) / MS.minute);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

/**
 * Locale of every date and number in the interface (the UI text is English). The format
 * helpers take it as their last argument, so a translation changes it in one place.
 */
export const UI_LOCALE = "en-US";

type DateInput = Date | string | number;

/** A count with thousands separators: "12,345". */
export function formatCount(count: number, locale = UI_LOCALE): string {
  return count.toLocaleString(locale);
}

/** Short date like "Oct 19" (sidebar "Deletes Oct 19", banners). Rendered in the viewer's time zone. */
export function formatShortDate(date: DateInput, locale = UI_LOCALE): string {
  return new Date(date).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** Date with the year, like the profile ("Oct 20, 2026"). Rendered in the viewer's time zone. */
export function formatLongDate(date: DateInput, locale = UI_LOCALE): string {
  return new Date(date).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

/** Date and time like the design: "Oct 5, 2026, 3:12 PM". */
export function formatDateTime(date: DateInput, locale = UI_LOCALE): string {
  return new Date(date).toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Date and time without the year: "Oct 5, 3:12 PM". */
export function formatShortDateTime(date: DateInput, locale = UI_LOCALE): string {
  return new Date(date).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Time of day with seconds: "3:12:08 PM". */
export function formatTimeOfDay(date: DateInput, locale = UI_LOCALE): string {
  return new Date(date).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** Weekday and hour: "Mon 3 PM". */
export function formatWeekdayHour(date: DateInput, locale = UI_LOCALE): string {
  return new Date(date).toLocaleString(locale, { weekday: "short", hour: "numeric" });
}

/** Relative time for activity logs: "just now", "5m ago", "3h ago", then the date. */
export function formatAgo(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return formatDateTime(at);
}

/** When a device was last used (profile devices): "active now", "12m ago", "3h ago", "4d ago". */
export function formatSeen(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "active now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}
