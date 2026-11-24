import "server-only";
import type { CleanBasis, CleanRule } from "@/domain/auto-clean";
import type { DbClient } from "../db/client";
import type { CleanBasis as DbCleanBasis } from "../db/generated/enums";

const BASIS_FROM_DB: Record<DbCleanBasis, CleanBasis> = { CREATED: "created", MODIFIED: "modified" };
const BASIS_TO_DB: Record<CleanBasis, DbCleanBasis> = { created: "CREATED", modified: "MODIFIED" };

/** A saved rule with the folder and account it belongs to (daily job). */
export interface FolderRuleRow extends CleanRule {
  folderId: string;
  accountId: string;
}

const RULE_SELECT = { folderId: true, accountId: true, olderThanDays: true, basis: true } as const;
const toRule = (row: { folderId: string; accountId: string; olderThanDays: number; basis: DbCleanBasis }): FolderRuleRow => ({ ...row, basis: BASIS_FROM_DB[row.basis] });

export async function findFolderRule(db: DbClient, accountId: string, folderId: string): Promise<FolderRuleRow | null> {
  const row = await db.folderRule.findFirst({ where: { accountId, folderId }, select: RULE_SELECT });
  return row && toRule(row);
}

export async function saveFolderRule(db: DbClient, accountId: string, folderId: string, rule: CleanRule): Promise<void> {
  const data = { olderThanDays: rule.olderThanDays, basis: BASIS_TO_DB[rule.basis] };
  await db.folderRule.upsert({ where: { folderId }, create: { folderId, accountId, ...data }, update: data });
}

export async function deleteFolderRule(db: DbClient, accountId: string, folderId: string): Promise<void> {
  await db.folderRule.deleteMany({ where: { accountId, folderId } });
}

/** One page of every account's rules in folder id order (keyset: `folderId > afterId`). */
export async function listFolderRules(db: DbClient, afterId: string | null, take: number): Promise<FolderRuleRow[]> {
  const rows = await db.folderRule.findMany({ where: afterId ? { folderId: { gt: afterId } } : {}, orderBy: { folderId: "asc" }, take, select: RULE_SELECT });
  return rows.map(toRule);
}

/**
 * Files directly in the folder dated before `cutoff` by the rule's basis (date modified falls
 * back to date added). Missing files are left alone: there is nothing on disk to move.
 */
function dueWhere(accountId: string, folderId: string, basis: CleanBasis, cutoff: Date) {
  const dated = basis === "created" ? { createdAt: { lt: cutoff } } : { OR: [{ modifiedAt: { lt: cutoff } }, { modifiedAt: null, createdAt: { lt: cutoff } }] };
  return { accountId, parentId: folderId, type: "FILE" as const, missing: false, ...dated };
}

export function countDueFiles(db: DbClient, accountId: string, folderId: string, basis: CleanBasis, cutoff: Date): Promise<number> {
  return db.node.count({ where: dueWhere(accountId, folderId, basis, cutoff) });
}

/** Due files in id order, leaving out `skip` (files that could not be moved this run). */
export async function dueFileIds(db: DbClient, accountId: string, folderId: string, basis: CleanBasis, cutoff: Date, take: number, skip: readonly string[] = []): Promise<string[]> {
  const where = dueWhere(accountId, folderId, basis, cutoff);
  const rows = await db.node.findMany({ where: skip.length ? { ...where, id: { notIn: [...skip] } } : where, orderBy: { id: "asc" }, take, select: { id: true } });
  return rows.map((row) => row.id);
}
