/**
 * "All Files": every file of an account in one list, without folders, read page by page in an
 * order the database keeps (the File Manager's sorts except "Type"). A page's cursor names the
 * sort value and id of its last file, so the next page starts right after it.
 */

import { SORT_OPTION_LABEL, SORT_SHORT_LABEL, type SortKey } from "./tree";

export const ALL_FILES_SORT_KEYS = ["date", "date-asc", "name", "name-desc", "size", "size-asc"] as const satisfies readonly SortKey[];
export type AllFilesSort = (typeof ALL_FILES_SORT_KEYS)[number];

export const ALL_FILES_SORT_OPTION_LABEL: Record<AllFilesSort, string> = Object.fromEntries(ALL_FILES_SORT_KEYS.map((key) => [key, SORT_OPTION_LABEL[key]])) as Record<AllFilesSort, string>;
export const ALL_FILES_SORT_SHORT_LABEL: Record<AllFilesSort, string> = Object.fromEntries(ALL_FILES_SORT_KEYS.map((key) => [key, SORT_SHORT_LABEL[key]])) as Record<AllFilesSort, string>;

/** The column a sort reads (date: date added) and its direction. */
export interface AllFilesOrder {
  column: "createdAt" | "name" | "size";
  desc: boolean;
}

const ORDERS: Record<AllFilesSort, AllFilesOrder> = {
  date: { column: "createdAt", desc: true },
  "date-asc": { column: "createdAt", desc: false },
  name: { column: "name", desc: false },
  "name-desc": { column: "name", desc: true },
  size: { column: "size", desc: true },
  "size-asc": { column: "size", desc: false },
};

export const allFilesOrder = (sort: AllFilesSort): AllFilesOrder => ORDERS[sort];

/** Where a page ended: the last file's sort value (epoch ms, bytes or name, as text) and id. */
export interface AllFilesPosition {
  value: string;
  id: string;
}

const ID = /^[a-z0-9]{6,32}$/;
const DIGITS = /^\d{1,20}$/;

/** "abcdefghjkmn.<encoded value>": the position after which the next page starts. */
export function encodeAllFilesCursor(position: AllFilesPosition): string {
  return `${position.id}.${encodeURIComponent(position.value)}`;
}

/** The position a cursor names for this sort, or null when it is not one {@link encodeAllFilesCursor} makes for it. */
export function decodeAllFilesCursor(cursor: string, sort: AllFilesSort): AllFilesPosition | null {
  const dot = cursor.indexOf(".");
  const id = cursor.slice(0, dot);
  if (dot < 0 || !ID.test(id)) return null;
  let value: string;
  try {
    value = decodeURIComponent(cursor.slice(dot + 1));
  } catch {
    return null;
  }
  // Dates and sizes are whole numbers; a name is any text.
  if (allFilesOrder(sort).column !== "name" && !DIGITS.test(value)) return null;
  return { value, id };
}

/** The sort value of a file, as a cursor keeps it. */
export function allFilesSortValue(file: { createdAt: Date; name: string; size: bigint }, sort: AllFilesSort): string {
  const { column } = allFilesOrder(sort);
  if (column === "createdAt") return String(file.createdAt.getTime());
  if (column === "size") return file.size.toString();
  return file.name;
}
