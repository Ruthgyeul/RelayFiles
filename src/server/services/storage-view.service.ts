import "server-only";
import { MS, STORAGE_VIEW } from "@/config/policy";
import type { StorageOverview } from "@/contracts/storage";
import { storageBars } from "@/domain/storage-view";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import type { AccountRow } from "../repositories/account.repo";
import { accountUsage, findRootFolder, largestFiles, listChildrenForRenumber, staleFiles } from "../repositories/node.repo";
import { childStats } from "../repositories/node-tree.repo";
import { accountTrashedBytes } from "../repositories/trash.repo";
import { withPaths } from "./node.service";

/**
 * The Storage page: the bars for the top of the root (one walk of the tree), the largest files,
 * old files without share-link activity and the trash, all from the account's own rows.
 */
export async function storageOverview(account: Pick<AccountRow, "id" | "quotaBytes">, now: Date = new Date()): Promise<StorageOverview> {
  const root = await findRootFolder(db(), account.id);
  if (!root) throw new ApiError("NOT_FOUND");
  const before = new Date(now.getTime() - STORAGE_VIEW.staleAfterDays * MS.day);
  const [usage, trash, children, stats, largest, stale] = await Promise.all([
    accountUsage(db(), account.id),
    accountTrashedBytes(db(), account.id),
    listChildrenForRenumber(db(), root.id),
    childStats(db(), root.id),
    largestFiles(db(), account.id, STORAGE_VIEW.largestFiles),
    staleFiles(db(), account.id, before, STORAGE_VIEW.staleFiles),
  ]);
  const entries = children.map((child) => ({ id: child.id, name: child.name, folder: child.type === "FOLDER", bytes: stats.get(child.id)?.size ?? 0n }));
  // One folder walk for both lists.
  const items = await withPaths(account.id, [...largest, ...stale]);
  return {
    usedBytes: usage.usedBytes.toString(),
    trashBytes: trash.toString(),
    quotaBytes: account.quotaBytes?.toString() ?? null,
    bars: storageBars(entries, usage.usedBytes, STORAGE_VIEW.maxBars),
    largest: items.slice(0, largest.length),
    stale: items.slice(largest.length),
    staleAfterDays: STORAGE_VIEW.staleAfterDays,
  };
}
