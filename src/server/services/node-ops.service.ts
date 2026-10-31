import "server-only";
import type { NodeItem } from "@/contracts/nodes";
import { nameError, uniqName } from "@/domain/names";
import { db } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { deleteNodes, findNode, findNodes, findRootFolder, listSiblingNames, updateNode, type NodeRow } from "../repositories/node.repo";
import { ancestorChain, subtreeRows } from "../repositories/node-tree.repo";
import { recordTrashed } from "../repositories/trash.repo";
import { withStorageTransaction } from "../storage/storage-transaction";
import { locationOf } from "./node-location";
import { toNodeItem } from "./node.service";
import { driverForAccount } from "./volume.service";

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

/** Deletes items with everything inside; files go to the volume's trash for the purge job. */
export async function deleteItems(owner: NodeOwner, ids: string[]): Promise<{ deleted: number }> {
  const items = await topLevel(owner.id, ids);
  if (items.length === 0) throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner, "write");
  const locations = await Promise.all(items.map((row) => locationOf(owner.id, row.id)));
  const files = (await Promise.all(items.map((row) => subtreeRows(db(), row.id)))).flat().filter((row) => row.type === "FILE");
  await withStorageTransaction(db(), async (tx, undo) => {
    await deleteNodes(
      tx,
      items.map((row) => row.id),
    );
    for (const location of locations) {
      const trashed = await driver.moveToTrash(location);
      undo.push("restore deleted item", () => driver.restoreFromTrash(trashed, location));
    }
    // The bytes stay on disk until the daily job empties the trash, and count until then.
    await recordTrashed(
      tx,
      owner.id,
      files.reduce((sum, row) => sum + row.size, 0n),
    );
  });
  // Thumbnails and stripped copies are rebuilt on demand, so they are removed right away.
  await driver.removeAssets(owner.id, files.map((row) => row.id)).catch((error: unknown) => logger.warn("assets not removed", { error }));
  return { deleted: items.length };
}
