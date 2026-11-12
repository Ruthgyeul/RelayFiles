import "server-only";
import { SHARE } from "@/config/policy";
import type { SharedView } from "@/contracts/shares";
import { isListedShare, visibilityInside, type ShareFolder } from "@/domain/shared-items";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { lastLinkEventAt } from "../repositories/link-event.repo";
import { listFolders, makeNodesPrivate, sharedCandidates, type NodeRow } from "../repositories/node.repo";
import { VISIBILITY, withPaths } from "./node.service";

const restricted = (row: NodeRow) => row.passwordHash !== null || row.downloadLimit !== null || row.expAt !== null || row.burn || row.dlPaused;

/**
 * "Shared by me": the items of an account that can be opened from outside. A public folder
 * stands for everything public inside it; items inside are listed on their own only when they
 * have limits of their own. Private items with leftover settings are not listed.
 */
export async function sharedItems(accountId: string): Promise<SharedView> {
  const [rows, folderRows] = await Promise.all([sharedCandidates(db(), accountId, SHARE.sharedListMax + 1), listFolders(db(), accountId)]);
  const truncated = rows.length > SHARE.sharedListMax;
  const folders = new Map<string, ShareFolder>(folderRows.map((folder) => [folder.id, { parentId: folder.parentId, visibility: VISIBILITY[folder.visibility] }]));
  const listed = rows.slice(0, SHARE.sharedListMax).filter((row) => isListedShare({ visibility: VISIBILITY[row.visibility], restricted: restricted(row) }, visibilityInside(row.parentId, folders)));
  const [items, lastUsed] = await Promise.all([
    withPaths(accountId, listed),
    lastLinkEventAt(
      db(),
      listed.map((row) => row.id),
    ),
  ]);
  return { items: items.map((item) => ({ ...item, lastActivityAt: lastUsed.get(item.id)?.toISOString() ?? null })), truncated };
}

/** "Make private" for several items at once; all or nothing (another account's item is 404). */
export async function makeItemsPrivate(accountId: string, ids: readonly string[]): Promise<{ updated: number }> {
  const unique = [...new Set(ids)];
  const updated = await db().$transaction(async (tx) => {
    const count = await makeNodesPrivate(tx, accountId, unique);
    if (count !== unique.length) throw new ApiError("NOT_FOUND");
    return count;
  });
  return { updated };
}
