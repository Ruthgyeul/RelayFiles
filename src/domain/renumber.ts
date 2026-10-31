/**
 * "Renumber files": the files directly inside a folder get the names 01, 02, 03, … in a chosen
 * order, keeping their extensions. Folders, hidden files and files missing on disk keep their
 * names. The plan is pure; the server applies it in two rename steps (docs/architecture.md "순번 정리").
 */
import { RENUMBER } from "@/config/policy";
import { nameError, splitExtension } from "./names";

export const RENUMBER_SORTS = ["name", "created", "modified"] as const;
export type RenumberSort = (typeof RENUMBER_SORTS)[number];

export const RENUMBER_ORDERS = ["asc", "desc"] as const;
export type RenumberOrder = (typeof RENUMBER_ORDERS)[number];

/** A direct child of the folder (times in ms). */
export interface RenumberCandidate {
  id: string;
  name: string;
  type: "file" | "folder";
  createdAt: number;
  /** The file's own modification time; null falls back to createdAt. */
  modifiedAt: number | null;
  missing: boolean;
}

export interface RenumberEntry {
  id: string;
  from: string;
  to: string;
}

export type RenumberSkipReason = "hidden" | "missing";

export interface RenumberPlan {
  /** Every numbered file in its new order, unchanged ones included (from === to). */
  entries: RenumberEntry[];
  skipped: { id: string; name: string; reason: RenumberSkipReason }[];
  digits: number;
  /** Why the plan cannot run (a new name is taken by an item that keeps its name), or null. */
  conflict: string | null;
}

/** Digits of the padded numbers: at least RENUMBER.minDigits, more when there are more files. */
export function renumberDigits(count: number): number {
  return Math.max(RENUMBER.minDigits, String(count).length);
}

/** Hidden (dot) names are never renumbered: ".env" must not become "05". */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/** The numbered name for position `index` (0-based): "07.jpg". */
export function numberedName(index: number, digits: number, original: string): string {
  const [, ext] = splitExtension(original, true);
  return `${String(index + 1).padStart(digits, "0")}${ext}`;
}

/** Temporary name between the two rename steps; hidden, so it never mixes with numbered names. */
export function renumberTempName(token: string, index: number): string {
  return `${RENUMBER.tempPrefix}${token}-${index}`;
}

const byName = (a: RenumberCandidate, b: RenumberCandidate) => a.name.localeCompare(b.name, undefined, { numeric: true });
const timeOf: Record<Exclude<RenumberSort, "name">, (file: RenumberCandidate) => number> = {
  created: (file) => file.createdAt,
  modified: (file) => file.modifiedAt ?? file.createdAt,
};

/** Orders files by the chosen key; ties fall back to the name, then the id, so a plan is stable. */
export function sortForRenumber(files: readonly RenumberCandidate[], sort: RenumberSort, order: RenumberOrder): RenumberCandidate[] {
  const direction = order === "asc" ? 1 : -1;
  const primary = sort === "name" ? byName : (a: RenumberCandidate, b: RenumberCandidate) => timeOf[sort](a) - timeOf[sort](b);
  return [...files].sort((a, b) => direction * primary(a, b) || byName(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Plans the new names for the children of one folder. */
export function planRenumber(children: readonly RenumberCandidate[], sort: RenumberSort, order: RenumberOrder): RenumberPlan {
  const skipped: RenumberPlan["skipped"] = [];
  const numbered: RenumberCandidate[] = [];
  const kept = new Set<string>();
  for (const child of children) {
    if (child.type === "folder") kept.add(child.name);
    else if (isHiddenName(child.name)) {
      kept.add(child.name);
      skipped.push({ id: child.id, name: child.name, reason: "hidden" });
    } else if (child.missing) {
      kept.add(child.name);
      skipped.push({ id: child.id, name: child.name, reason: "missing" });
    } else numbered.push(child);
  }

  const digits = renumberDigits(numbered.length);
  const entries = sortForRenumber(numbered, sort, order).map((file, index) => ({ id: file.id, from: file.name, to: numberedName(index, digits, file.name) }));
  const clash = entries.find((entry) => kept.has(entry.to));
  const invalid = entries.find((entry) => nameError(entry.to) !== "");
  const conflict = clash ? `"${clash.to}" is already used by an item that keeps its name. Rename or move it first.` : invalid ? nameError(invalid.to) : null;
  return { entries, skipped, digits, conflict };
}

/** Entries whose name actually changes. */
export function renumberChanges(plan: Pick<RenumberPlan, "entries">): RenumberEntry[] {
  return plan.entries.filter((entry) => entry.from !== entry.to);
}

const sameEntries = (expected: readonly Pick<RenumberEntry, "id" | "to">[], actual: readonly RenumberEntry[]) =>
  expected.length === actual.length && expected.every((entry, index) => entry.id === actual[index]!.id && entry.to === actual[index]!.to);

/**
 * True when the plan the client reviewed is the one the server would run now. The client sends
 * only the files whose name changes, in order, and how many files the plan numbered (`count`): a
 * file added or removed meanwhile changes the count or shifts the numbers. Without `count` (the
 * first release's clients), `expected` is the whole plan.
 */
export function matchesReviewed(expected: readonly Pick<RenumberEntry, "id" | "to">[], plan: Pick<RenumberPlan, "entries">, count?: number): boolean {
  if (count === undefined) return sameEntries(expected, plan.entries);
  return count === plan.entries.length && sameEntries(expected, renumberChanges(plan));
}
