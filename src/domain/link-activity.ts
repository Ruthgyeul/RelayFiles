import { MS } from "@/config/policy";
import { toCsv } from "./csv";

/**
 * Share link activity: the Activity dialog's summary (how often a link was opened, looked at,
 * played and downloaded, overall and in recent days) and its CSV export.
 */

/** Event kinds the summary counts ("reset" marks a regenerated link, not a visit). */
export const ACTIVITY_KINDS = ["open", "view", "play", "download"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityCounts = Record<ActivityKind, number>;

export interface ActivityEvent {
  kind: string;
  fileName: string;
  device: string;
  ipMasked: string;
  country: string;
  /** ISO time. */
  at: string;
}

export interface ActivitySummary {
  all: ActivityCounts;
  /** One entry per requested period, in the order given. */
  recent: { days: number; counts: ActivityCounts }[];
}

const isActivityKind = (kind: string): kind is ActivityKind => (ACTIVITY_KINDS as readonly string[]).includes(kind);
const zero = (): ActivityCounts => ({ open: 0, view: 0, play: 0, download: 0 });

/** Counts per kind overall and within each of the last `periodDays` days (up to `now`). */
export function activitySummary(events: readonly Pick<ActivityEvent, "kind" | "at">[], now: number, periodDays: readonly number[]): ActivitySummary {
  const all = zero();
  const recent = periodDays.map((days) => ({ days, since: now - days * MS.day, counts: zero() }));
  for (const event of events) {
    if (!isActivityKind(event.kind)) continue;
    all[event.kind] += 1;
    const at = Date.parse(event.at);
    for (const period of recent) if (at >= period.since && at <= now) period.counts[event.kind] += 1;
  }
  return { all, recent: recent.map(({ days, counts }) => ({ days, counts })) };
}

const CSV_HEADER = ["Time (UTC)", "Event", "File", "Device", "Address", "Country"] as const;

/** The log as CSV, one row per event in the given order (cells formula-guarded, see `csvCell`). */
export function activityCsv(events: readonly ActivityEvent[]): string {
  return toCsv([CSV_HEADER, ...events.map((event) => [event.at, event.kind, event.fileName, event.device, event.ipMasked, event.country])]);
}

/** "Holiday activity.csv" for an item named "Holiday". */
export function activityCsvName(itemName: string): string {
  return `${itemName} activity.csv`;
}
