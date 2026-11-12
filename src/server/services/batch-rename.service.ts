import "server-only";
import { nameError } from "@/domain/names";
import { db } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { findNodes, listChildrenForRenumber, lockFolderForRenumber } from "../repositories/node.repo";
import { StorageTargetExistsError, type StorageLocation } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { renameInFolder, type ChildRename } from "./folder-rename";
import { locationOf } from "./node-location";
import type { NodeOwner } from "./node-ops.service";
import { renumberTimeoutMs } from "./renumber.service";
import { driverForAccount, lockAccountForWrite } from "./volume.service";

const CHANGED_MESSAGE = "This folder changed. Review the new names.";

/** Refuses invalid names and two items given the same name; returns the names checked. */
function checkNames(items: readonly { id: string; name: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const error = nameError(item.name);
    if (error) throw new ApiError("BAD_REQUEST", `"${item.name}": ${error}`);
    if (seen.has(item.name)) throw new ApiError("BAD_REQUEST", `Two items can't both be named "${item.name}".`);
    seen.add(item.name);
  }
}

/**
 * Renames several items of one folder at once ("Rename" for a selection), in one storage
 * transaction with temporary names first, so items can swap names. Items of another account
 * are 404, items of several folders a 400; a name taken by an item outside the selection is a
 * 409 and nothing is renamed. Node ids stay the same (links, tags and settings are kept).
 */
export async function renameBatch(owner: NodeOwner, items: readonly { id: string; name: string }[]): Promise<{ renamed: number }> {
  checkNames(items);
  const rows = await findNodes(
    db(),
    owner.id,
    items.map((item) => item.id),
  );
  if (rows.length !== items.length) throw new ApiError("NOT_FOUND");
  const folderId = rows[0]!.parentId;
  if (folderId === null) throw new ApiError("BAD_REQUEST", "The root folder can't be renamed here.");
  if (rows.some((row) => row.parentId !== folderId)) throw new ApiError("BAD_REQUEST", "Rename items of one folder at a time.");

  const driver = await driverForAccount(owner, "write");
  const base = await locationOf(owner.id, folderId);
  const at = (name: string): StorageLocation => ({ accountId: owner.id, segments: [...base.segments, name] });
  const wanted = new Map(items.map((item) => [item.id, item.name]));
  try {
    return await withStorageTransaction(
      db(),
      async (tx, undo) => {
        await lockAccountForWrite(tx, owner.id, driver.volumeId);
        await lockFolderForRenumber(tx, folderId);
        // Read again under the lock: the names now, not the ones the request was made from.
        const children = await listChildrenForRenumber(tx, folderId);
        const current = new Map(children.filter((child) => wanted.has(child.id)).map((child) => [child.id, child.name]));
        if (current.size !== wanted.size) throw new ApiError("CONFLICT", CHANGED_MESSAGE);
        const kept = new Set(children.filter((child) => !wanted.has(child.id)).map((child) => child.name));
        const taken = [...wanted.values()].find((name) => kept.has(name));
        if (taken !== undefined) throw new ApiError("CONFLICT", `"${taken}" already exists here.`);
        const changes: ChildRename[] = [...wanted].flatMap(([id, to]) => (current.get(id) === to ? [] : [{ id, from: current.get(id)!, to }]));
        await renameInFolder(tx, folderId, driver, undo, at, changes, new Set(children.map((child) => child.name)), CHANGED_MESSAGE);
        return { renamed: changes.length };
      },
      { timeoutMs: renumberTimeoutMs(items.length) },
    );
  } catch (caught) {
    if (caught instanceof StorageTargetExistsError || isUniqueViolation(caught)) throw new ApiError("CONFLICT", `${CHANGED_MESSAGE} Nothing was renamed.`);
    throw caught;
  }
}
