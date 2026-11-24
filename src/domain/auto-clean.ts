/**
 * Folder auto-clean rules (docs/architecture.md "자동 정리"): every day, files directly in the
 * folder that are older than the rule move to Recently deleted, where they can be restored.
 */

import { MS } from "@/config/policy";
import { plural } from "./format";

/** Which date makes a file old: when it was added here, or when its content last changed. */
export type CleanBasis = "created" | "modified";

export interface CleanRule {
  olderThanDays: number;
  basis: CleanBasis;
}

/** A file's dates as the rule reads them; `modifiedAt` is null for files without one. */
export interface CleanDates {
  createdAt: Date;
  modifiedAt: Date | null;
}

/** Files dated before this are old by the rule at `now`. */
export function cleanCutoff(olderThanDays: number, now: Date): Date {
  return new Date(now.getTime() - olderThanDays * MS.day);
}

/** The date the rule compares: date modified falls back to date added, as everywhere else. */
export function cleanDateOf(file: CleanDates, basis: CleanBasis): Date {
  return basis === "created" ? file.createdAt : (file.modifiedAt ?? file.createdAt);
}

/** Whether the rule moves this file at `now`. */
export function isDueForClean(file: CleanDates, rule: CleanRule, now: Date): boolean {
  return cleanDateOf(file, rule.basis).getTime() < cleanCutoff(rule.olderThanDays, now).getTime();
}

const BASIS_TEXT: Record<CleanBasis, string> = { created: "added", modified: "modified" };

/** "30 days": the age of a rule, for the folder tag and the dialog. */
export const cleanAgeText = (days: number): string => plural(days, "day");

/** The folder tag: "Auto clean · 30 days". */
export const cleanTagLabel = (rule: CleanRule): string => `Auto clean · ${cleanAgeText(rule.olderThanDays)}`;

/** "Files directly in this folder added more than 30 days ago move to Recently deleted every day." */
export function cleanRuleText(rule: CleanRule): string {
  return `Files directly in this folder ${BASIS_TEXT[rule.basis]} more than ${cleanAgeText(rule.olderThanDays)} ago move to Recently deleted every day.`;
}

/**
 * "12 files would move now" / "No files would move now": the preview under the choices. Past
 * `perRun` (the most one daily run moves), it says the rest follow on the next days.
 */
export function cleanPreviewText(count: number, perRun: number): string {
  if (count === 0) return "No files would move now.";
  if (count > perRun) return `${plural(count, "file")} are due: ${plural(perRun, "file")} move today, the rest on the next days.`;
  return `${plural(count, "file")} would move now.`;
}
