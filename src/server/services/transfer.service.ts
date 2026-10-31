import "server-only";
import { randomUUID } from "node:crypto";
import type { TransferResult } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { uniqName } from "@/domain/names";
import { segmentsBelowRoot } from "@/domain/tree";
import { db, Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import { insertNodes, listSiblingNames, updateNode } from "../repositories/node.repo";
import { ancestorChain, subtreeRows } from "../repositories/node-tree.repo";
import { findVolume } from "../repositories/volume.repo";
import { withStorageTransaction } from "../storage/storage-transaction";
import { assertItemRoom } from "./item-limit.service";
import { locationOf } from "./node-location";
import { requireFolder, topLevel, type NodeOwner } from "./node-ops.service";
import { releaseSpace, reserveSpace } from "./space.service";
import { driverForAccount } from "./volume.service";

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
  const items = (await topLevel(owner.id, ids)).filter((row) => row.id !== target.id && row.parentId !== target.id && !isInside(targetIds, row.id));
  if (items.length === 0) throw new ApiError("BAD_REQUEST", "Can't move there");

  const driver = await driverForAccount(owner, "write");
  const targetSegments = segmentsBelowRoot(targetChain);
  const taken = await listSiblingNames(db(), target.id);
  let renamed = 0;
  const plan = await Promise.all(
    items.map(async (row) => ({ row, from: await locationOf(owner.id, row.id) })),
  );
  await withStorageTransaction(db(), async (tx, undo) => {
    for (const { row, from } of plan) {
      const name = uniqName(taken, row.name, row.type === "FILE");
      taken.push(name);
      if (name !== row.name) renamed++;
      await updateNode(tx, row.id, { parent: { connect: { id: target.id } }, name });
      const to = { accountId: owner.id, segments: [...targetSegments, name] };
      await driver.rename(from, to);
      undo.push("undo move", () => driver.rename(to, from));
    }
  });
  return { done: items.length, renamed, targetName: target.name };
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
 */
export async function copyNodes(owner: NodeOwner, ids: string[], targetRef: string): Promise<TransferResult> {
  const target = await requireFolder(owner.id, targetRef);
  const targetChain = await ancestorChain(db(), target.id);
  const items = (await topLevel(owner.id, ids)).filter((row) => !isInside(targetChain.map((ancestor) => ancestor.id), row.id));
  if (items.length === 0) throw new ApiError("BAD_REQUEST", "Can't copy there");

  const trees = await Promise.all(items.map((row) => subtreeRows(db(), row.id)));
  await assertItemRoom(owner, trees.reduce((sum, tree) => sum + tree.length, 0));
  const bytes = trees.flat().reduce((sum, row) => sum + (row.type === "FILE" ? row.size : 0n), 0n);
  const driver = await driverForAccount(owner, "write");
  const volume = await findVolume(db(), owner.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const reservation = `copy-${randomUUID()}`;
  await reserveSpace(owner, reservation, Number(bytes), { id: volume.id, reservePct: volume.reservePct, driver });

  const staged: string[] = [];
  try {
    const copies = await Promise.all(items.map(async (row) => ({ row, from: await locationOf(owner.id, row.id) })));
    for (const { from } of copies) staged.push(await driver.stageCopy(from));

    const targetSegments = segmentsBelowRoot(targetChain);
    const taken = await listSiblingNames(db(), target.id);
    let renamed = 0;
    const now = new Date();
    const media: string[] = [];
    await withStorageTransaction(db(), async (tx, undo) => {
      for (const [index, { row }] of copies.entries()) {
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
        await insertNodes(tx, rows);
        const to = { accountId: owner.id, segments: [...targetSegments, name] };
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
  } finally {
    // Copies that did not get into place (an error part-way) leave nothing in the temp area.
    for (const path of staged) await driver.discardStaged(path).catch((error: unknown) => logger.warn("staged copy not removed", { error }));
    await releaseSpace(reservation, owner.id, volume.id).catch((error: unknown) => logger.warn("copy reservation not released", { error }));
  }
}
