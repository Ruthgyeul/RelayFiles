/**
 * "Rename" for several items of one folder: one pattern applied to every name, with the result
 * checked before anything changes (valid names, no two items ending up with the same name, no
 * name taken by an item outside the selection).
 */
import { nameError, splitExtension } from "./names";

export type NameCase = "keep" | "lower" | "upper";

export interface RenamePattern {
  /** Text to find in each name ("" = none) and what replaces it. */
  find: string;
  replace: string;
  matchCase: boolean;
  /** Added before and after the name; `{n}` in them (and in `replace`) is the item's number. */
  prefix: string;
  suffix: string;
  /** Changes apply to the name without its extension, and the extension stays as it is. */
  keepExtension: boolean;
  nameCase: NameCase;
  /** Number of the first item and the digits each number is padded to. */
  start: number;
  digits: number;
}

export const DEFAULT_PATTERN: RenamePattern = { find: "", replace: "", matchCase: false, prefix: "", suffix: "", keepExtension: true, nameCase: "keep", start: 1, digits: 2 };

export interface RenameItem {
  id: string;
  name: string;
  isFile: boolean;
}

export interface RenameRow {
  id: string;
  from: string;
  to: string;
  /** Why this row can't be renamed, or null. */
  error: string | null;
}

const NUMBER_TOKEN = /\{n\}/g;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function applyCase(text: string, nameCase: NameCase): string {
  if (nameCase === "lower") return text.toLowerCase();
  if (nameCase === "upper") return text.toUpperCase();
  return text;
}

/** One name with the pattern applied; `index` is its place in the selection (0 = first). */
export function renamedName(item: Pick<RenameItem, "name" | "isFile">, index: number, pattern: RenamePattern): string {
  const number = String(pattern.start + index).padStart(pattern.digits, "0");
  const fill = (text: string) => text.replace(NUMBER_TOKEN, number);
  const [base, extension] = pattern.keepExtension ? splitExtension(item.name, item.isFile) : [item.name, ""];
  const found = pattern.find ? base.replace(new RegExp(escapeRegExp(pattern.find), pattern.matchCase ? "g" : "gi"), fill(pattern.replace).replace(/\$/g, "$$$$")) : base;
  return applyCase(`${fill(pattern.prefix)}${found}${fill(pattern.suffix)}`, pattern.nameCase) + extension;
}

/**
 * Every item with its new name, in selection order. `others` are the names in the folder that
 * are not selected (they keep their names); null when they are unknown, so only the selection
 * is checked here and the server checks the rest.
 */
export function planBatchRename(items: readonly RenameItem[], pattern: RenamePattern, others: readonly string[] | null): RenameRow[] {
  const rows = items.map((item, index) => ({ id: item.id, from: item.name, to: renamedName(item, index, pattern) }));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.to, (counts.get(row.to) ?? 0) + 1);
  const taken = new Set(others ?? []);
  return rows.map((row) => {
    const invalid = nameError(row.to);
    if (invalid) return { ...row, error: invalid };
    if ((counts.get(row.to) ?? 0) > 1) return { ...row, error: "Another selected item gets this name." };
    if (taken.has(row.to)) return { ...row, error: "An item with this name is already here." };
    return { ...row, error: null };
  });
}

/** The rows that change a name; the request sends only these. */
export function renameChanges(rows: readonly RenameRow[]): { id: string; name: string }[] {
  return rows.filter((row) => row.from !== row.to).map((row) => ({ id: row.id, name: row.to }));
}
