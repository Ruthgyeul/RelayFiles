/**
 * The "Photos" timeline: pages are ordered by a date (taken, else file date) and the item id,
 * and the cursor of a page names the last item it held.
 */

export interface TimelinePosition {
  /** The item's date in epoch milliseconds. */
  at: number;
  id: string;
}

/** "1730000000000.abcdefghjkmn": the position after which the next page starts. */
export function encodeTimelineCursor(position: TimelinePosition): string {
  return `${position.at}.${position.id}`;
}

/** The position a cursor names, or null when it is not one {@link encodeTimelineCursor} makes. */
export function decodeTimelineCursor(cursor: string): TimelinePosition | null {
  const match = /^(\d{1,16})\.([a-z0-9]{6,32})$/.exec(cursor);
  if (!match) return null;
  const at = Number(match[1]);
  return Number.isSafeInteger(at) ? { at, id: match[2]! } : null;
}

export interface MonthGroup<T> {
  /** "2026-11" in the given time zone. */
  key: string;
  /** "November 2026" */
  label: string;
  items: T[];
}

/**
 * Consecutive items of the same calendar month in `timeZone` (the viewer's), in their order. The
 * list is sorted newest first, so each month appears once.
 */
export function groupByMonth<T extends { date: string }>(items: readonly T[], timeZone: string, locale = "en-US"): MonthGroup<T>[] {
  const keyOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" });
  const labelOf = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "long" });
  const groups: MonthGroup<T>[] = [];
  for (const item of items) {
    const date = new Date(item.date);
    const key = keyOf.format(date).slice(0, 7);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: labelOf.format(date), items: [item] });
  }
  return groups;
}
