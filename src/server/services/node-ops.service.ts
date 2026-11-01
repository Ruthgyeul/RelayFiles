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
import { createDeletedItem, nodeRowsByIds, toSnapshot } from "../repositories/deleted-item.repo";
import { deleteNodes, findNode, findNodes, findRootFolder, listSiblingNames, updateNode, type NodeRow } from "../repositories/node.repo";
import { ancestorChain, lockSubtrees, type AncestorRow } from "../repositories/node-tree.repo";
import { addTrashedBytes, recordTrashed } from "../repositories/trash.repo";
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

/** Top-level items only: drops items whose ancestor is also in the list (and the root unless allowed). */
export async function topLevel(accountId: string, ids: string[], allowRoot = false): Promise<NodeRow[]> {
  const rows = (await findNodes(db(), accountId, [...new Set(ids)])).filter((row) => allowRoot || row.parentId !== null);
  const chosen = new Set(rows.map((row) => row.id));
  const result: NodeRow[] = [];
  for (const row of rows) {
    const chain = await ancestorChain(db(), row.id);
    if (!chain.slice(0, -1).some((ancestor) => chosen.has(ancestor.id))) result.push(row);
  }
  return result;
}

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
  const chains = await Promise.all(items.map((row) => ancestorChain(db(), row.id)));
  const locations = chains.map((chain) => ({ accountId: owner.id, segments: segmentsBelowRoot(chain) }));
  const files = await withStorageTransaction(db(), async (tx, undo) => {
    await lockAccountForWrite(tx, owner.id, driver.volumeId);
    // Counted from the rows this transaction deletes: nothing can be added below them meanwhile.
    const rows = await lockSubtrees(
      tx,
      items.map((row) => row.id),
      STORAGE.subtreeLockAttempts,
    );
    if (!rows) throw new ApiError("CONFLICT", "These items are changing. Try again.");
    // Every column of the locked rows, read before they go, so a restore can put them back.
    const full = recoverable ? await nodeRowsByIds(tx, rows.map((row) => row.id)) : [];
    await deleteNodes(
      tx,
      items.map((row) => row.id),
    );
    const trashed: string[] = [];
    for (const location of locations) {
      const entry = await driver.moveToTrash(location);
      undo.push("restore deleted item", () => driver.restoreFromTrash(entry, location));
      trashed.push(entry);
    }
    const deleted = rows.filter((row) => row.type === "FILE");
    // The bytes stay on disk until the daily job empties the trash, and count until then.
    if (recoverable) await recordDeletedItems(tx, owner.id, driver.volumeId, { items, chains, trashed, rows, full });
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
  items: NodeRow[];
  /** Each item's ancestor chain (account root first, the item last). */
  chains: AncestorRow[][];
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
    trees.items.map((item) => item.id),
  );
  const at = new Date();
  for (const [index, item] of trees.items.entries()) {
    const tree = groups.get(item.id)!;
    const bytes = tree.reduce((sum, row) => sum + (row.type === "FILE" ? row.size : 0n), 0n);
    await createDeletedItem(tx, {
      id: newDeletedItemId(),
      accountId,
      volumeId,
      trashPath: trees.trashed[index]!,
      trashedBytesId: await addTrashedBytes(tx, { accountId, volumeId, bytes, at }),
      name: item.name,
      type: item.type,
      kind: item.kind,
      size: bytes,
      itemCount: tree.length,
      originalParentId: item.parentId,
      originalPath: trees.chains[index]!.slice(0, -1).map((ancestor) => ancestor.name),
      deletedAt: at,
      nodes: toSnapshot(tree),
    });
  }
}
