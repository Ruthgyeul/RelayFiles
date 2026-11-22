import "server-only";
import { SHARE } from "@/config/policy";
import type { SharedView } from "@/contracts/shares";
import { isListedShare, visibilityInside, type ShareFolder } from "@/domain/shared-items";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { lastLinkEventAt } from "../repositories/link-event.repo";
import { makeNodesPrivate, sharedCandidates, type NodeRow } from "../repositories/node.repo";
import type { AncestorRow } from "../repositories/node-tree.repo";
import { parentChains, withPaths } from "./node.service";
import { VISIBILITY } from "./node-dto";

const restricted = (row: NodeRow) => row.passwordHash !== null || row.downloadLimit !== null || row.expAt !== null || row.burn || row.dlPaused;

/** Each folder on the chains with its parent and visibility (a chain lists root first). */
function foldersOf(chains: ReadonlyMap<string, readonly AncestorRow[]>): Map<string, ShareFolder> {
  const folders = new Map<string, ShareFolder>();
  for (const chain of chains.values()) {
    chain.forEach((folder, index) => folders.set(folder.id, { parentId: chain[index - 1]?.id ?? null, visibility: VISIBILITY[folder.visibility] }));
  }
  return folders;
}

/**
 * "Shared by me": the items of an account that can be opened from outside. A public folder
 * stands for everything public inside it; items inside are listed on their own only when they
 * have limits of their own. Private items with leftover settings are not listed.
 */
export async function sharedItems(accountId: string): Promise<SharedView> {
  const rows = await sharedCandidates(db(), accountId, SHARE.sharedListMax + 1);
  const truncated = rows.length > SHARE.sharedListMax;
  const candidates = rows.slice(0, SHARE.sharedListMax);
  // The folders above the candidates, read once for both the visibility check and the paths.
  const chains = await parentChains(candidates);
  const folders = foldersOf(chains);
  const listed = candidates.filter((row) => isListedShare({ visibility: VISIBILITY[row.visibility], restricted: restricted(row) }, visibilityInside(row.parentId, folders)));
  const [items, lastUsed] = await Promise.all([
    withPaths(listed, chains),
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
