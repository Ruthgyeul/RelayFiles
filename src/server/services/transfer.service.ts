import "server-only";
import { randomUUID } from "node:crypto";
import type { TransferResult } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { uniqName } from "@/domain/names";
import { segmentsBelowRoot } from "@/domain/tree";
import { db, Prisma } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { insertNodes, listSiblingNames, moveIntoFolder } from "../repositories/node.repo";
import { ancestorChain, subtreeRowsOf } from "../repositories/node-tree.repo";
import { findVolume } from "../repositories/volume.repo";
import { StorageEntryMissingError, type CopyEntry } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { assertItemRoom } from "./item-limit.service";
import { requireFolder, topLevel, topLocation, type NodeOwner } from "./node-ops.service";
import { releaseSpace, reserveSpace } from "./space.service";
import { driverForAccount, lockAccountForWrite } from "./volume.service";

const NAME_TAKEN_MESSAGE = "Something with the same name was just added there. Try again.";
const CHANGED_MESSAGE = "Some items changed while they were being copied. Try again.";
const MOVE_CHANGED_MESSAGE = "Some items changed while they were being moved. Try again.";

/** True when `nodeId` is the folder or inside it. */
function isInside(chainIds: string[], nodeId: string): boolean {
  return chainIds.includes(nodeId);
}

/**
 * Moves items into a folder: items already there, the target itself and
 * anything that would land inside itself are skipped; clashing names get "Name (2)".
 */
export async function moveNodes(owner: NodeOwner, ids: string[], targetRef: string): Promise<TransferResult> {
  const target = await requireFolder(owner.id, targetRef);
  const targetChain = await ancestorChain(db(), target.id);
  const targetIds = targetChain.map((row) => row.id);
  const items = (await topLevel(owner.id, ids)).filter(({ row }) => row.id !== target.id && row.parentId !== target.id && !isInside(targetIds, row.id));
  if (items.length === 0) throw new ApiError("BAD_REQUEST", "Can't move there");

  const driver = await driverForAccount(owner, "write");
  const targetSegments = segmentsBelowRoot(targetChain);
  const taken = await listSiblingNames(db(), target.id);
  const plan = items.map((item) => {
    const name = uniqName(taken, item.row.name, item.row.type === "FILE");
    taken.push(name);
    return { id: item.row.id, name, from: topLocation(owner.id, item), to: { accountId: owner.id, segments: [...targetSegments, name] } };
  });
  const renamed = plan.filter((move, index) => move.name !== items[index]!.row.name).length;
  try {
    await withStorageTransaction(db(), async (tx, undo) => {
      await lockAccountForWrite(tx, owner.id, driver.volumeId);
      // Every row in one statement; an item deleted meanwhile leaves the count short.
      const moved = await moveIntoFolder(tx, owner.id, target.id, plan);
      if (moved !== plan.length) throw new ApiError("CONFLICT", MOVE_CHANGED_MESSAGE);
      for (const { from, to } of plan) {
        await driver.rename(from, to);
        undo.push("undo move", () => driver.rename(to, from));
      }
    });
  } catch (caught) {
    // Something got one of the names in the target after they were read: nothing was moved.
    if (isUniqueViolation(caught)) throw new ApiError("CONFLICT", NAME_TAKEN_MESSAGE);
    throw caught;
  }
  return { done: items.length, renamed, targetName: target.name };
}

/**
 * What a copied tree holds on disk, by folder names below its top (parents before children, as
 * subtreeRowsOf returns them). Files flagged missing have nothing to copy; their copies keep the flag.
 */
function copyEntries(tree: readonly { id: string; parentId: string | null; name: string; type: "FILE" | "FOLDER"; missing: boolean }[], topId: string): CopyEntry[] {
  const segments = new Map<string, string[]>();
  const entries: CopyEntry[] = [];
  for (const row of tree) {
    const own = row.id === topId ? [] : [...segments.get(row.parentId!)!, row.name];
    segments.set(row.id, own);
    if (row.type === "FILE" && row.missing) continue;
    entries.push({ segments: own, type: row.type === "FILE" ? "file" : "folder" });
  }
  return entries;
}

/**
 * Copies items with everything inside: new ids and links, zero
 * downloads, settings and tags kept. Bytes are copied on the volume (reflink when possible).
 *
 * The space is reserved like an upload's (account quota, the volume's reserve, the anonymous
 * total and uploads in progress), so copies started together cannot overrun them. Bytes are
 * copied into the volume's temp area first, outside any database transaction: a large copy
 * must not hold a database connection (or run past the transaction timeout and roll back
 * after the work). Only the renames into place and the new rows share one short transaction.
 * Staging copies the files of the rows read at the start, one by one (not the folder as it is on
 * disk later), so the new rows and the staged files always match; a file renamed or deleted
 * meanwhile stops the copy with 409 and nothing is left behind.
 */
export async function copyNodes(owner: NodeOwner, ids: string[], targetRef: string): Promise<TransferResult> {
  const target = await requireFolder(owner.id, targetRef);
  const targetChain = await ancestorChain(db(), target.id);
  const items = (await topLevel(owner.id, ids)).filter(({ row }) => !isInside(targetChain.map((ancestor) => ancestor.id), row.id));
  if (items.length === 0) throw new ApiError("BAD_REQUEST", "Can't copy there");

  // Every selected tree in one walk.
  const byTop = await subtreeRowsOf(
    db(),
    items.map(({ row }) => row.id),
  );
  const trees = items.map(({ row }) => byTop.get(row.id) ?? []);
  await assertItemRoom(owner, trees.reduce((sum, tree) => sum + tree.length, 0));
  const bytes = trees.flat().reduce((sum, row) => sum + (row.type === "FILE" ? row.size : 0n), 0n);
  const driver = await driverForAccount(owner, "write");
  const volume = await findVolume(db(), owner.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const reservation = `copy-${randomUUID()}`;
  await reserveSpace(owner, reservation, Number(bytes), { id: volume.id, reservePct: volume.reservePct, driver });

  const staged: string[] = [];
  try {
    const copies = items.map((item) => ({ row: item.row, from: topLocation(owner.id, item) }));
    // Exactly the rows read above, not whatever the folder holds on disk now.
    for (const [index, { row, from }] of copies.entries()) staged.push(await driver.stageCopy(from, copyEntries(trees[index]!, row.id)));

    const targetSegments = segmentsBelowRoot(targetChain);
    const taken = await listSiblingNames(db(), target.id);
    let renamed = 0;
    const now = new Date();
    const media: string[] = [];
    await withStorageTransaction(db(), async (tx, undo) => {
      // Staging can take long: the account may have started moving to another volume meanwhile.
      await lockAccountForWrite(tx, owner.id, driver.volumeId);
      const placed = copies.map(({ row }, index) => {
        const name = uniqName(taken, row.name, row.type === "FILE");
        taken.push(name);
        if (name !== row.name) renamed++;
        const newIds = new Map<string, string>();
        const rows = trees[index]!.map((source) => {
          const id = newNodeId();
          newIds.set(source.id, id);
          const isTop = source.id === row.id;
          return {
            ...source,
            id,
            parentId: isTop ? target.id : newIds.get(source.parentId!)!,
            name: isTop ? name : source.name,
            linkId: newLinkId(),
            downloads: 0,
            hasThumb: false,
            hasDerived: false,
            stripFailed: false,
            createdAt: now,
            updatedAt: now,
          } satisfies Prisma.NodeCreateManyInput;
        });
        return { rows, to: { accountId: owner.id, segments: [...targetSegments, name] } };
      });
      // The rows of every copy in one statement, then each copy into place on disk.
      await insertNodes(
        tx,
        placed.flatMap(({ rows }) => rows),
      );
      for (const [index, { rows, to }] of placed.entries()) {
        await driver.moveIntoPlace(staged[index]!, to);
        undo.push("remove copy", async () => {
          await driver.moveToTrash(to);
        });
        media.push(...rows.filter((copy) => copy.type === "FILE" && (copy.kind === "IMAGE" || copy.kind === "VIDEO")).map((copy) => copy.id));
      }
    });
    // Assets are keyed by node id, so copies get their own (rebuilt by the worker).
    void enqueueMedia(media);
    return { done: items.length, renamed, targetName: target.name };
  } catch (caught) {
    if (caught instanceof StorageEntryMissingError) throw new ApiError("CONFLICT", CHANGED_MESSAGE);
    if (isUniqueViolation(caught)) throw new ApiError("CONFLICT", NAME_TAKEN_MESSAGE);
    throw caught;
  } finally {
    // Copies that did not get into place (an error part-way) leave nothing in the temp area.
    for (const path of staged) await driver.discardStaged(path).catch((error: unknown) => logger.warn("staged copy not removed", { error }));
    await releaseSpace(reservation, owner.id, volume.id).catch((error: unknown) => logger.warn("copy reservation not released", { error }));
  }
}
