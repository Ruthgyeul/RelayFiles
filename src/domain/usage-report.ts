/**
 * Admin usage report: the day range a report covers, the months its traffic chart shows,
 * sorting and the CSV export. Days are UTC calendar days ("YYYY-MM-DD"), the same days
 * traffic is counted in (TrafficDaily).
 */

const DAY_MS = 86_400_000;
const ISO_DAY_LENGTH = 10;
const MONTH_LENGTH = 7;
const MONTHS_PER_YEAR = 12;

export interface ReportRange {
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
  days: number;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, ISO_DAY_LENGTH);
const msOf = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The range a report covers: `to` defaults to today, `from` to `defaultDays` before it. A range
 * that ends before it starts, or is longer than `maxDays`, is an error message instead.
 */
export function reportRange(input: { from?: string; to?: string }, now: number, limits: { defaultDays: number; maxDays: number }): ReportRange | { error: string } {
  const to = input.to ?? dayOf(now);
  const from = input.from ?? dayOf(msOf(to) - (limits.defaultDays - 1) * DAY_MS);
  if (Number.isNaN(msOf(from)) || Number.isNaN(msOf(to))) return { error: "Dates are YYYY-MM-DD." };
  const days = Math.round((msOf(to) - msOf(from)) / DAY_MS) + 1;
  if (days < 1) return { error: "The range ends before it starts." };
  if (days > limits.maxDays) return { error: `A report covers at most ${limits.maxDays} days.` };
  return { from, to, days };
}

/** The range ending today that covers `days` days. */
export function rangeEndingToday(days: number, now: number): { from: string; to: string } {
  return { from: dayOf(now - (days - 1) * DAY_MS), to: dayOf(now) };
}

/** Every month ("YYYY-MM") the range touches, oldest first. */
export function monthsOf(range: Pick<ReportRange, "from" | "to">): string[] {
  const months: string[] = [];
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, MONTH_LENGTH));
  const last = range.to.slice(0, MONTH_LENGTH);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= last) return months;
    month += 1;
    if (month > MONTHS_PER_YEAR) {
      month = 1;
      year += 1;
    }
  }
}

/** Traffic per month of the range, with 0 for months that have none. */
export function fillMonths(range: Pick<ReportRange, "from" | "to">, totals: ReadonlyMap<string, bigint>): { month: string; bytes: string }[] {
  return monthsOf(range).map((month) => ({ month, bytes: (totals.get(month) ?? 0n).toString() }));
}

/** One account row of the report (sizes as decimal strings: they can exceed 2^53). */
export interface UsageRowValues {
  id: string;
  name: string;
  isAdmin: boolean;
  usedBytes: string;
  quotaBytes: string | null;
  files: number;
  folders: number;
  trashBytes: string;
  trafficBytes: string;
  apiTokens: number;
  lastLoginAt: string;
}

export const USAGE_SORTS = [
  { key: "used", label: "Storage" },
  { key: "traffic", label: "Traffic" },
  { key: "trash", label: "Trash" },
  { key: "items", label: "Items" },
  { key: "name", label: "Name" },
] as const;
export type UsageSort = (typeof USAGE_SORTS)[number]["key"];

const byBytes = (a: string, b: string) => {
  const difference = BigInt(b) - BigInt(a);
  return difference > 0n ? 1 : difference < 0n ? -1 : 0;
};

/** Rows largest first by `key` (names A to Z), ties by name. */
export function sortUsage<T extends UsageRowValues>(rows: readonly T[], key: UsageSort): T[] {
  const compare: Record<UsageSort, (a: T, b: T) => number> = {
    used: (a, b) => byBytes(a.usedBytes, b.usedBytes),
    traffic: (a, b) => byBytes(a.trafficBytes, b.trafficBytes),
    trash: (a, b) => byBytes(a.trashBytes, b.trashBytes),
    items: (a, b) => b.files + b.folders - (a.files + a.folders),
    name: () => 0,
  };
  return [...rows].sort((a, b) => compare[key](a, b) || a.name.localeCompare(b.name));
}

export const USAGE_CSV_HEADER = [
  "Account ID",
  "Name",
  "Role",
  "Storage used (bytes)",
  "Storage limit (bytes)",
  "Files",
  "Folders",
  "Trash (bytes)",
  "Share traffic (bytes)",
  "API tokens",
  "Last sign-in",
] as const;

/** The CSV rows (after the header) of a report, in the order given. */
export function usageCsvRows(rows: readonly UsageRowValues[]): (string | number)[][] {
  return rows.map((row) => [
    row.id,
    row.name,
    row.isAdmin ? "Admin" : "Member",
    row.usedBytes,
    row.quotaBytes ?? "",
    row.files,
    row.folders,
    row.trashBytes,
    row.trafficBytes,
    row.apiTokens,
    row.lastLoginAt,
  ]);
}

/** "relayfiles-usage-2026-10-14-2026-11-12.csv" */
export function usageCsvName(range: Pick<ReportRange, "from" | "to">): string {
  return `relayfiles-usage-${range.from}-${range.to}.csv`;
}
