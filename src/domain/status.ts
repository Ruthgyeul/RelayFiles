import { STATUS } from "@/config/policy";

/**
 * Service status levels from the design's Status page (`LV`). The footer and the Status
 * page use the same wording.
 */
export type StatusLevel = "ok" | "warn" | "down";

export const STATUS_TITLE: Record<StatusLevel, string> = {
  ok: "All systems operational",
  warn: "Degraded performance",
  down: "Can't reach the server",
};

/** Maps the health endpoint's component status to a level. */
export function levelOfHealth(status: "ok" | "degraded" | "down" | null): StatusLevel {
  if (status === "ok") return "ok";
  if (status === "degraded") return "warn";
  return "down";
}

// ---------------------------------------------------------------------------
// Browser checks ("Your connection")
// ---------------------------------------------------------------------------

/** One browser check of the server (design `ping`). */
export interface Ping {
  ms: number;
  ok: boolean;
  at: number;
}

export interface ConnectionStats {
  last: Ping | null;
  /** Average of the successful checks, ms. */
  avg: number | null;
  /** Mean difference between consecutive successful checks, ms. */
  jitter: number | null;
  /** Failed checks, percent. */
  loss: number;
  checks: number;
  okChecks: number;
}

const PERCENT = 100;

export function connectionStats(pings: readonly Ping[]): ConnectionStats {
  const ok = pings.filter((ping) => ping.ok);
  const avg = ok.length ? Math.round(ok.reduce((sum, ping) => sum + ping.ms, 0) / ok.length) : null;
  const jitter = ok.length > 1 ? Math.round(ok.slice(1).reduce((sum, ping, i) => sum + Math.abs(ping.ms - ok[i]!.ms), 0) / (ok.length - 1)) : null;
  const loss = pings.length ? Math.round(((pings.length - ok.length) / pings.length) * PERCENT) : 0;
  return { last: pings.at(-1) ?? null, avg, jitter, loss, checks: pings.length, okChecks: ok.length };
}

/** Overall card level (design `lvl`): down when offline or the last check failed. */
export function connectionLevel(stats: ConnectionStats, online: boolean): StatusLevel {
  if (!online || (stats.last && !stats.last.ok)) return "down";
  if ((stats.avg !== null && stats.avg > STATUS.degradedAvgMs) || stats.loss > STATUS.degradedLossPercent) return "warn";
  return "ok";
}

/** Color family for a measured value; "neutral" while measuring. */
export type Tone = "ok" | "warn" | "bad" | "neutral";

export function latencyRating(ms: number | null): string {
  if (ms === null) return "Measuring…";
  if (ms < STATUS.excellentMs) return "Excellent";
  if (ms < STATUS.goodMs) return "Good";
  if (ms < STATUS.fairMs) return "Fair";
  return "Poor";
}

export function latencyTone(ms: number | null): Tone {
  if (ms === null) return "neutral";
  if (ms < STATUS.goodMs) return "ok";
  return ms < STATUS.fairMs ? "warn" : "bad";
}

export function jitterRating(jitter: number | null): { text: string; tone: Tone } {
  if (jitter === null) return { text: "Measuring…", tone: "neutral" };
  if (jitter < STATUS.stableJitterMs) return { text: "Stable", tone: "ok" };
  return jitter < STATUS.variableJitterMs ? { text: "Some variation", tone: "warn" } : { text: "Unstable", tone: "bad" };
}

export function lossTone(loss: number): Tone {
  if (loss === 0) return "ok";
  return loss <= STATUS.degradedLossPercent ? "warn" : "bad";
}

// ---------------------------------------------------------------------------
// Service components (server-side probes)
// ---------------------------------------------------------------------------

export const COMPONENTS = [
  { key: "website", name: "Website", detail: "Pages & sign-in" },
  { key: "uploads", name: "Uploads", detail: "Chunked, resumable" },
  { key: "streaming", name: "Streaming", detail: "Video & audio playback" },
  { key: "downloads", name: "Downloads", detail: "Files & zip archives" },
  { key: "shares", name: "Share links", detail: "Public share pages" },
  { key: "storage", name: "Storage", detail: "File volume" },
] as const;
export type ComponentKey = (typeof COMPONENTS)[number]["key"];

/** What one probe of the running app found. */
export interface ProbeResult {
  /** The app answered its health endpoint. */
  reachable: boolean;
  database: boolean;
  redis: boolean;
  /** The storage volume is mounted and identified. */
  storage: boolean;
  /** The upload staging area accepts writes. */
  writable: boolean;
}

/** Which user-facing features work, given what each one depends on. */
export function componentChecks(probe: ProbeResult): Record<ComponentKey, boolean> {
  const app = probe.reachable && probe.database;
  return {
    website: app,
    uploads: app && probe.redis && probe.storage && probe.writable,
    streaming: app && probe.storage,
    downloads: app && probe.redis && probe.storage,
    shares: app && probe.redis,
    storage: probe.storage,
  };
}

export type DayLevel = "ok" | "warn" | "down" | "nodata";

/** One day of a component (design strip colors): any failure degrades, many failures are an outage. */
export function dayLevel(okCount: number, failCount: number): DayLevel {
  const total = okCount + failCount;
  if (total === 0) return "nodata";
  if (failCount === 0) return "ok";
  return (failCount / total) * PERCENT > STATUS.outageFailPercent ? "down" : "warn";
}

export const DAY_TEXT: Record<DayLevel, string> = { ok: "No issues", warn: "Degraded", down: "Outage", nodata: "No data" };

/** Share of successful checks, percent; null without checks. */
export function uptimePercent(okCount: number, failCount: number): number | null {
  const total = okCount + failCount;
  return total === 0 ? null : (okCount / total) * PERCENT;
}

/** "99.94% uptime" or "No data yet". */
export function uptimeText(percent: number | null): string {
  return percent === null ? "No data yet" : `${percent.toFixed(2)}% uptime`;
}

export type ComponentState = "operational" | "slow" | "outage" | "unreachable" | "nodata";

export const COMPONENT_STATE_LABEL: Record<ComponentState, string> = {
  operational: "OPERATIONAL",
  slow: "SLOW",
  outage: "OUTAGE",
  unreachable: "UNREACHABLE",
  nodata: "NO DATA",
};

/**
 * Current state of a component: this browser can't reach the server → unreachable; no recent
 * probe → no data; the latest probe failed → outage; a slow connection slows every network
 * feature (design: `SLOW` for all but Storage).
 */
export function componentState(key: ComponentKey, clientLevel: StatusLevel, latestOk: boolean | null): ComponentState {
  if (clientLevel === "down") return "unreachable";
  if (latestOk === null) return "nodata";
  if (!latestOk) return "outage";
  return clientLevel === "warn" && key !== "storage" ? "slow" : "operational";
}

/** One hour of the latency chart: average probe latency, or failed when no probe succeeded. */
export type LatencyHour = { avgMs: number; failed: false } | { avgMs: null; failed: true } | null;

/** AVG 48H / BEST / PEAK / UNREACHABLE (design `h48`), from hours with data. */
export function latencySummary(hours: readonly LatencyHour[]): { avg: number | null; best: number | null; peak: number | null; unreachable: number } {
  const ms = hours.flatMap((hour) => (hour && !hour.failed ? [hour.avgMs] : []));
  const unreachable = hours.filter((hour) => hour?.failed).length;
  if (ms.length === 0) return { avg: null, best: null, peak: null, unreachable };
  return { avg: Math.round(ms.reduce((sum, value) => sum + value, 0) / ms.length), best: Math.min(...ms), peak: Math.max(...ms), unreachable };
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENT_SEVERITIES = ["minor", "major", "maint"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** Badge text and chooser label (design `SV`, `incSevOpts`). */
export const SEVERITY_LABEL: Record<IncidentSeverity, { badge: string; option: string }> = {
  minor: { badge: "MINOR", option: "Minor" },
  major: { badge: "MAJOR", option: "Major" },
  maint: { badge: "MAINTENANCE", option: "Maintenance" },
};

/** "Oct 2, 2026 · 25 min · Resolved" (design `when`); the date part is formatted by the caller. */
export function incidentWhen(date: string, duration: string, resolved: boolean): string {
  return [date, duration.trim(), resolved ? "Resolved" : "Ongoing"].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Calendar days
// ---------------------------------------------------------------------------

/** "2026-10-05": the calendar day of `at` in `timeZone`. */
export function dayKeyIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const DAY_MS = 86_400_000;

/** The `count` days ending with `lastDay`, oldest first. */
export function dayKeysEndingWith(lastDay: string, count: number): string[] {
  const last = Date.parse(`${lastDay}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(last - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** "Oct 5" / "Oct 5, 2026" for a calendar day, independent of the viewer's time zone. */
export function formatDayKey(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}
