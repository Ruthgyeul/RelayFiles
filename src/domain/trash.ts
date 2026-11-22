/**
 * "Recently deleted": deleted items wait in the volume's trash for a retention window
 * (TRASH_RETENTION_HOURS) and can be restored until the daily job empties it.
 */

import { MS } from "@/config/policy";
import { formatSize } from "./format";

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

/** What a delete confirmation needs to know about an item. */
export interface DeletedItem {
  name: string;
  type: "file" | "folder";
  /** Bytes (a decimal string from the API, or a number). */
  size: string | number;
  /** Files inside (folders), 1 for a file. */
  fileCount: number;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `"name"` for one item, "3 items" for several: the subject of a dialog title. */
export function itemsLabel(items: readonly Pick<DeletedItem, "name">[]): string {
  return items.length === 1 ? `"${items[0]!.name}"` : `${items.length} items`;
}

/** Delete confirmation text (the design's, with the "Recently deleted" window instead of "can't be undone"). */
export function deleteText(items: readonly DeletedItem[], retentionHours: number): { title: string; text: string } {
  const one = items.length === 1 ? items[0]! : null;
  const size = items.reduce((sum, item) => sum + Number(item.size), 0);
  const files = items.reduce((sum, item) => sum + item.fileCount, 0);
  const what = one && one.type === "file" ? formatSize(size) : `${plural(files, "file")} · ${formatSize(size)}`;
  return {
    title: one ? `Delete "${one.name}"?` : `Delete ${items.length} items?`,
    text: `${what} will be moved to Recently deleted and can be restored for ${retentionText(retentionHours)}, then ${one ? "it is" : "they are"} removed for good. Share links to ${one ? "it" : "them"} stop working.`,
  };
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
