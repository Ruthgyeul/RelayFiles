/**
 * "Recently deleted": deleted items wait in the volume's trash for a retention window
 * (STORAGE.trashRetentionHours) and can be restored until the daily job empties it.
 */

import { MS } from "@/config/policy";

const HOUR_MS = MS.hour;

/** A row of a deleted tree: its id and the folder it is in. */
export interface TreeRow {
  id: string;
  parentId: string | null;
}

/**
 * Splits the rows of several deleted trees (parents before children, as lockSubtrees returns
 * them) into one list per top item, keeping their order. Rows whose folder is in none of the
 * trees are dropped.
 */
export function groupByTop<T extends TreeRow>(rows: readonly T[], topIds: readonly string[]): Map<string, T[]> {
  const groups = new Map<string, T[]>(topIds.map((id) => [id, []]));
  const topOf = new Map<string, string>();
  for (const row of rows) {
    const top = groups.has(row.id) ? row.id : row.parentId === null ? undefined : topOf.get(row.parentId);
    if (top === undefined) continue;
    topOf.set(row.id, top);
    groups.get(top)!.push(row);
  }
  return groups;
}

/** When a deleted item is removed for good at the earliest (the daily job removes it on its first run after this). */
export function trashExpiresAt(deletedAt: Date, retentionHours: number): Date {
  return new Date(deletedAt.getTime() + retentionHours * HOUR_MS);
}

/** "24 hours": how long deleted items can be restored, for the delete confirmations. */
export function retentionText(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** "Deletes in 5 hours" for a deleted item, from when it expires; "Deletes soon" once that has passed. */
export function deletesInText(expiresAt: Date | string, now: number): string {
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return "Deletes soon";
  if (left < HOUR_MS) return "Deletes in less than an hour";
  const hours = Math.ceil(left / HOUR_MS);
  return `Deletes in ${retentionText(hours)}`;
}

/** "root / Photos / 2024": the folder a deleted item was in (names from the account root down), for display. */
export function originalLocation(path: readonly string[]): string {
  return path.join(" / ");
}
