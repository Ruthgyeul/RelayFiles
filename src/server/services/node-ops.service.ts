import "server-only";
import { STORAGE } from "@/config/policy";
import type { NodeItem } from "@/contracts/nodes";
import { newDeletedItemId } from "@/domain/ids";
import { nameError, uniqName } from "@/domain/names";
import { groupByTop } from "@/domain/trash";
import { segmentsBelowRoot } from "@/domain/tree";
import { db, type DbClient } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import type { Node } from "../db/generated/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { createDeletedItems, nodeRowsByIds, toSnapshot } from "../repositories/deleted-item.repo";
import { deleteNodes, findNode, findNodes, findRootFolder, listSiblingNames, updateNode, type NodeRow } from "../repositories/node.repo";
import { ancestorChains, lockSubtrees, type AncestorRow } from "../repositories/node-tree.repo";
import { addTrashedBytesEach, recordTrashed } from "../repositories/trash.repo";
import type { StorageLocation } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { locationOf } from "./node-location";
import { toNodeItem } from "./node.service";
import { driverForAccount, lockAccountForWrite } from "./volume.service";

/** The account an item operation acts for (its own items only). */
export type NodeOwner = Pick<AccountRow, "id" | "volumeId" | "isAdmin" | "quotaBytes">;

export async function requireNode(accountId: string, nodeId: string): Promise<NodeRow> {
  const row = await findNode(db(), accountId, nodeId);
  if (!row) throw new ApiError("NOT_FOUND");
  return row;
}

export async function requireFolder(accountId: string, ref: string): Promise<NodeRow> {
  const row = ref === "root" ? await findRootFolder(db(), accountId) : await findNode(db(), accountId, ref);
  if (!row || row.type !== "FOLDER") throw new ApiError("NOT_FOUND");
  return row;
}

/** Renames in the database and on disk; a taken name is refused with a suggestion (design wording). */
export async function renameNode(owner: NodeOwner, nodeId: string, requested: string): Promise<NodeItem> {
  const name = requested.trim();
  const error = nameError(name);
  if (error) throw new ApiError("BAD_REQUEST", error, { fields: { name: error } });
  const row = await requireNode(owner.id, nodeId);
  if (row.name === name) return toNodeItem(row);

  const conflict = async () => {
    const siblings = row.parentId ? (await listSiblingNames(db(), row.parentId)).filter((sibling) => sibling !== row.name) : [];
    const message = `Server rejected: "${name}" already exists here. Suggested: ${uniqName(siblings, name, row.type === "FILE")}`;
    return new ApiError("CONFLICT", message, { fields: { name: message } });
  };
  if (row.parentId && (await listSiblingNames(db(), row.parentId)).includes(name)) throw await conflict();

  // The root's folder on disk is named after the account id, so only its display name changes.
  if (!row.parentId) return toNodeItem(await updateNode(db(), row.id, { name }));
  const driver = await driverForAccount(owner, "write");
  const from = await locationOf(owner.id, row.id);
  const to = { ...from, segments: [...from.segments.slice(0, -1), name] };
  try {
    const updated = await withStorageTransaction(db(), async (tx, undo) => {
      await lockAccountForWrite(tx, owner.id, driver.volumeId);
      const result = await updateNode(tx, row.id, { name });
      await driver.rename(from, to);
      undo.push("undo rename", () => driver.rename(to, from));
      return result;
    });
    return toNodeItem(updated);
  } catch (caught) {
    if (isUniqueViolation(caught)) throw await conflict();
    throw caught;
  }
}

/** A selected item that is not inside another selected one, with its chain from the account root. */
export interface TopItem {
  row: NodeRow;
  /** Account root first, the item last (its storage location is `segmentsBelowRoot(chain)`). */
  chain: AncestorRow[];
}

/**
 * Top-level items only: drops items whose ancestor is also in the list (and the root unless
 * allowed). Two queries for any number of ids: the rows, then every chain in one walk.
 */
export async function topLevel(accountId: string, ids: string[], allowRoot = false): Promise<TopItem[]> {
  const rows = (await findNodes(db(), accountId, [...new Set(ids)])).filter((row) => allowRoot || row.parentId !== null);
  const chosen = new Set(rows.map((row) => row.id));
  const chains = await ancestorChains(db(), [...chosen]);
  const result: TopItem[] = [];
  for (const row of rows) {
    const chain = chains.get(row.id);
    // Deleted since it was read: nothing to act on.
    if (!chain) continue;
    if (!chain.slice(0, -1).some((ancestor) => chosen.has(ancestor.id))) result.push({ row, chain });
  }
  return result;
}

/** Where a top-level item is on its account's volume. */
export const topLocation = (accountId: string, item: TopItem): StorageLocation => ({ accountId, segments: segmentsBelowRoot(item.chain) });

/**
 * Deletes items with everything inside; files go to the volume's trash for the purge job.
 * Each top-level item stays under "Recently deleted" (a DeletedItem with its rows) until then,
 * unless `recoverable` is false: items the cleanup deletes because their link expired or was
 * downloaded once are gone for good (a restore would bring back the ended link).
 */
export async function deleteItems(owner: NodeOwner, ids: string[], { recoverable = true }: { recoverable?: boolean } = {}): Promise<{ deleted: number }> {
  const items = await topLevel(owner.id, ids);
  if (items.length === 0) throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner, "write");
  const locations = items.map((item) => topLocation(owner.id, item));
  const itemIds = items.map(({ row }) => row.id);
  const files = await withStorageTransaction(db(), async (tx, undo) => {
    await lockAccountForWrite(tx, owner.id, driver.volumeId);
    // Counted from the rows this transaction deletes: nothing can be added below them meanwhile.
    const rows = await lockSubtrees(tx, itemIds, STORAGE.subtreeLockAttempts);
    if (!rows) throw new ApiError("CONFLICT", "These items are changing. Try again.");
    // Every column of the locked rows, read before they go, so a restore can put them back.
    const full = recoverable ? await nodeRowsByIds(tx, rows.map((row) => row.id)) : [];
    await deleteNodes(tx, itemIds);
    const trashed: string[] = [];
    for (const location of locations) {
      const entry = await driver.moveToTrash(location);
      undo.push("restore deleted item", () => driver.restoreFromTrash(entry, location));
      trashed.push(entry);
    }
    const deleted = rows.filter((row) => row.type === "FILE");
    // The bytes stay on disk until the daily job empties the trash, and count until then.
    if (recoverable) await recordDeletedItems(tx, owner.id, driver.volumeId, { items, trashed, rows, full });
    else
      await recordTrashed(
        tx,
        owner.id,
        deleted.reduce((sum, row) => sum + row.size, 0n),
      );
    return deleted;
  });
  // Thumbnails and stripped copies are rebuilt on demand, so they are removed right away.
  await driver.removeAssets(owner.id, files.map((row) => row.id)).catch((error: unknown) => logger.warn("assets not removed", { error }));
  return { deleted: items.length };
}

interface DeletedTrees {
  items: TopItem[];
  /** Where each item went in the trash. */
  trashed: string[];
  /** The locked rows in lock order (parents before children). */
  rows: readonly { id: string }[];
  /** Every column of those rows. */
  full: Node[];
}

/**
 * Keeps each deleted item under "Recently deleted": its rows, where it waits in the trash and
 * its file bytes as a TrashedBytes row of its own. The rows add up to what one row for all of
 * them would hold, so the quota counts exactly as before; a restore takes back only its own.
 */
async function recordDeletedItems(tx: DbClient, accountId: string, volumeId: string, trees: DeletedTrees): Promise<void> {
  const byId = new Map(trees.full.map((row) => [row.id, row]));
  const groups = groupByTop(
    trees.rows.map((row) => byId.get(row.id)!),
    trees.items.map(({ row }) => row.id),
  );
  const at = new Date();
  const deleted = trees.items.map(({ row }) => {
    const tree = groups.get(row.id)!;
    return { tree, bytes: tree.reduce((sum, node) => sum + (node.type === "FILE" ? node.size : 0n), 0n) };
  });
  // One statement each for all items, however many were selected.
  const trashedBytesIds = await addTrashedBytesEach(
    tx,
    deleted.map(({ bytes }) => ({ accountId, volumeId, bytes, at })),
  );
  await createDeletedItems(
    tx,
    trees.items.map(({ row, chain }, index) => ({
      id: newDeletedItemId(),
      accountId,
      volumeId,
      trashPath: trees.trashed[index]!,
      trashedBytesId: trashedBytesIds[index]!,
      name: row.name,
      type: row.type,
      kind: row.kind,
      size: deleted[index]!.bytes,
      itemCount: deleted[index]!.tree.length,
      originalParentId: row.parentId,
      originalPath: chain.slice(0, -1).map((ancestor) => ancestor.name),
      deletedAt: at,
      nodes: toSnapshot(deleted[index]!.tree),
    })),
  );
}
