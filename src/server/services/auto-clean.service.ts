import "server-only";
import { AUTO_CLEAN } from "@/config/policy";
import type { AutoCleanView } from "@/contracts/auto-clean";
import { cleanCutoff, type CleanRule } from "@/domain/auto-clean";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { findAccountById } from "../repositories/account.repo";
import { countDueFiles, deleteFolderRule, dueFileIds, findFolderRule, listFolderRules, saveFolderRule, type FolderRuleRow } from "../repositories/folder-rule.repo";
import { requireFolder, type NodeOwner } from "./node-access";
import { deleteItems } from "./node-ops.service";

/** A folder of the account that can have a rule: not the root (everything would be in reach). */
async function ruleFolder(accountId: string, folderRef: string) {
  const folder = await requireFolder(accountId, folderRef);
  if (folder.parentId === null) throw new ApiError("BAD_REQUEST", "The root folder can't clean itself. Choose a folder inside it.");
  return folder;
}

/** The folder's rule and how many files `preview` (or the saved rule) would move at `now`. */
export async function getAutoClean(owner: NodeOwner, folderRef: string, preview: CleanRule | null, now = new Date()): Promise<AutoCleanView> {
  const folder = await ruleFolder(owner.id, folderRef);
  const saved = await findFolderRule(db(), owner.id, folder.id);
  const rule = saved && { olderThanDays: saved.olderThanDays, basis: saved.basis };
  const counted = preview ?? rule;
  const due = counted ? await countDueFiles(db(), owner.id, folder.id, counted.basis, cleanCutoff(counted.olderThanDays, now)) : 0;
  return { rule, due };
}

/** The rule shown on the folder's header, without the checks of a request (the folder page). */
export async function autoCleanRuleOf(accountId: string, folderId: string): Promise<CleanRule | null> {
  const saved = await findFolderRule(db(), accountId, folderId);
  return saved && { olderThanDays: saved.olderThanDays, basis: saved.basis };
}

export async function setAutoClean(owner: NodeOwner, folderRef: string, rule: CleanRule): Promise<AutoCleanView> {
  const folder = await ruleFolder(owner.id, folderRef);
  await saveFolderRule(db(), owner.id, folder.id, rule);
  return getAutoClean(owner, folder.id, null);
}

export async function removeAutoClean(owner: NodeOwner, folderRef: string): Promise<void> {
  const folder = await ruleFolder(owner.id, folderRef);
  await deleteFolderRule(db(), owner.id, folder.id);
}

/**
 * Moves one rule's old files to Recently deleted, at most `limit` (the rest
 * move on the next days). Each batch is its own delete, so a failure keeps what moved before it.
 */
async function cleanFolder(owner: NodeOwner, rule: FolderRuleRow, now: Date, limit: number): Promise<number> {
  const cutoff = cleanCutoff(rule.olderThanDays, now);
  let moved = 0;
  while (moved < limit) {
    const ids = await dueFileIds(db(), owner.id, rule.folderId, rule.basis, cutoff, Math.min(AUTO_CLEAN.batchSize, limit - moved));
    if (ids.length === 0) break;
    moved += (await deleteItems(owner, ids)).deleted;
  }
  return moved;
}

/** The daily run of every rule (maintenance job, after the cleanup): files moved in all. `limit`: per rule. */
export async function runAutoClean(now: Date, limit: number = AUTO_CLEAN.perRunLimit): Promise<{ rules: number; files: number }> {
  const result = { rules: 0, files: 0 };
  let afterId: string | null = null;
  for (;;) {
    const page = await listFolderRules(db(), afterId, AUTO_CLEAN.rulePage);
    for (const rule of page) {
      try {
        const owner = await findAccountById(db(), rule.accountId);
        if (!owner) continue;
        result.files += await cleanFolder(owner, rule, now, limit);
        result.rules++;
      } catch (error) {
        // One folder's failure (a locked subtree, a read-only volume) leaves the others to run.
        logger.warn("auto clean: folder not cleaned", { folderId: rule.folderId, error });
      }
    }
    const last = page.at(-1);
    if (!last || page.length < AUTO_CLEAN.rulePage) break;
    afterId = last.folderId;
  }
  return result;
}
