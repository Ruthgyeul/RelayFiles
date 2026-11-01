import "server-only";
import { STORAGE } from "@/config/policy";
import type { NodeKind } from "@/contracts/nodes";
import type { DeletedItemDto, RestoredItem } from "@/contracts/trash";
import { newLinkId } from "@/domain/ids";
import { uniqName } from "@/domain/names";
import { trashExpiresAt } from "@/domain/trash";
import { db, type DbClient } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { findDeletedItem, fromSnapshot, listDeletedItems, takeDeletedItem, takenLinkIds } from "../repositories/deleted-item.repo";
import { findNode, findRootFolder, insertNodes, listSiblingNames } from "../repositories/node.repo";
import { removeTrashedBytes } from "../repositories/trash.repo";
import { StorageEntryMissingError, StorageTargetExistsError } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { assertItemRoom } from "./item-limit.service";
import { lockedLocationOf } from "./node-location";
import type { NodeOwner } from "./node-ops.service";
import { driverForAccount, lockAccountForWrite } from "./volume.service";

const MOVED_MESSAGE = "This item was deleted before your files moved to new storage, so it can't be restored. It is removed for good with the rest of the old storage's trash.";
const NAME_TAKEN_MESSAGE = "Something with the same name was just added there. Try again.";
const IN_THE_WAY_MESSAGE = "Something on the server's disk is in the way. Ask the admin to run a storage check, then try again.";
const GONE_MESSAGE = "This item was already removed for good.";

/** "Recently deleted" of an account, newest first. */
export async function listRecentlyDeleted(accountId: string): Promise<DeletedItemDto[]> {
  const rows = await listDeletedItems(db(), accountId, STORAGE.recentlyDeletedListMax);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type === "FOLDER" ? "folder" : "file",
    kind: row.kind ? (row.kind.toLowerCase() as NodeKind) : null,
    size: row.size.toString(),
    itemCount: row.itemCount,
    deletedAt: row.deletedAt.toISOString(),
    expiresAt: trashExpiresAt(row.deletedAt, STORAGE.trashRetentionHours).toISOString(),
    location: row.originalPath,
  }));
}

/** A deleted item of the owner on the volume the owner is on now (other accounts' items are 404). */
async function requireDeletedItem(owner: NodeOwner, id: string) {
  const item = await findDeletedItem(db(), owner.id, id);
  if (!item) throw new ApiError("NOT_FOUND");
  // Its files wait in the trash of the volume it was deleted on, which the account has left.
  if (item.volumeId !== owner.volumeId) throw new ApiError("CONFLICT", MOVED_MESSAGE);
  return item;
}

interface RestoreTarget {
  id: string;
  name: string;
  isRoot: boolean;
  segments: readonly string[];
}

/**
 * The folder a restored item goes into, locked with its folders (FOR SHARE) until the
 * transaction ends so it cannot be renamed, moved or deleted meanwhile: its old folder while
 * that is still a folder of the account, else the account root.
 */
async function restoreTarget(tx: DbClient, accountId: string, parentId: string | null): Promise<RestoreTarget & { original: boolean }> {
  const parent = parentId ? await findNode(tx, accountId, parentId) : null;
  if (parent?.type === "FOLDER") {
    const location = await lockedLocationOf(tx, accountId, parent.id);
    if (location) return { id: parent.id, name: parent.name, isRoot: parent.parentId === null, segments: location.segments, original: true };
  }
  const root = await findRootFolder(tx, accountId);
  const location = root && (await lockedLocationOf(tx, accountId, root.id));
  if (!root || !location) throw new ApiError("NOT_FOUND");
  return { id: root.id, name: root.name, isRoot: true, segments: location.segments, original: root.id === parentId };
}


/**
 * Puts a deleted item back: its rows with the same ids, links, share settings and tags, and its
 * files moved out of the trash, into its old folder (or the account root when that is gone),
 * named "Name (2)" when the name is taken there. Its bytes stop counting as trash and count as
 * files again, so the storage used does not change. Link activity and upload links of the
 * deleted items are not restored; thumbnails and stripped copies are made again.
 */
export async function restoreDeletedItem(owner: NodeOwner, id: string): Promise<RestoredItem> {
  const item = await requireDeletedItem(owner, id);
  const driver = await driverForAccount(owner, "write");
  const now = new Date();
  const rows = fromSnapshot(item.nodes, owner.id, now);
  await assertItemRoom(owner, rows.length);
  const top = rows[0]!;
  try {
    const restored = await withStorageTransaction(db(), async (tx, undo) => {
      await lockAccountForWrite(tx, owner.id, driver.volumeId);
      // Locks the row: a second restore (or a delete forever) of the item waits, then finds nothing.
      if (!(await takeDeletedItem(tx, owner.id, item.id))) throw new ApiError("NOT_FOUND");
      const target = await restoreTarget(tx, owner.id, item.originalParentId);
      const name = uniqName(await listSiblingNames(tx, target.id), item.name, item.type === "FILE");
      // Links never change, but one taken meanwhile (another restore cannot take it) gets a new one.
      const taken = await takenLinkIds(
        tx,
        rows.map((row) => row.linkId),
      );
      await insertNodes(
        tx,
        rows.map((row) => ({
          ...row,
          parentId: row.id === top.id ? target.id : row.parentId,
          name: row.id === top.id ? name : row.name,
          linkId: taken.has(row.linkId) ? newLinkId() : row.linkId,
        })),
      );
      if (item.trashedBytesId) await removeTrashedBytes(tx, owner.id, item.trashedBytesId);
      const to = { accountId: owner.id, segments: [...target.segments, name] };
      await driver.restoreFromTrash(item.trashPath, to);
      undo.push("return restored item to the trash", () => driver.returnToTrash(to, item.trashPath));
      return { name, renamed: name !== item.name, folderId: target.id, folderName: target.name, folderIsRoot: target.isRoot, inOriginalFolder: target.original };
    });
    // Generated files are keyed by node id and were removed on delete: the worker makes them again.
    void enqueueMedia(rows.filter((row) => row.type === "FILE" && !row.missing && (row.kind === "IMAGE" || row.kind === "VIDEO")).map((row) => row.id));
    return restored;
  } catch (caught) {
    if (isUniqueViolation(caught)) throw new ApiError("CONFLICT", NAME_TAKEN_MESSAGE);
    if (caught instanceof StorageTargetExistsError) throw new ApiError("CONFLICT", IN_THE_WAY_MESSAGE);
    // The daily job emptied the trash after the list was read; the row goes with the next run.
    if (caught instanceof StorageEntryMissingError) throw new ApiError("GONE", GONE_MESSAGE);
    throw caught;
  }
}

/** "Delete forever": forgets the item and its trashed bytes, then removes its files from the trash. */
export async function deleteForever(owner: NodeOwner, id: string): Promise<void> {
  const item = await requireDeletedItem(owner, id);
  const driver = await driverForAccount(owner, "write");
  await withStorageTransaction(db(), async (tx) => {
    await lockAccountForWrite(tx, owner.id, driver.volumeId);
    if (!(await takeDeletedItem(tx, owner.id, item.id))) throw new ApiError("NOT_FOUND");
    if (item.trashedBytesId) await removeTrashedBytes(tx, owner.id, item.trashedBytesId);
  });
  // After the commit: removed files cannot come back if the commit failed. Left over, the daily job removes them.
  await driver.removeFromTrash(item.trashPath).catch((error: unknown) => logger.warn("trash entry not removed", { error }));
}
