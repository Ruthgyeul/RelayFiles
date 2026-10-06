import "server-only";
import { hash } from "@node-rs/argon2";
import type { LinkEventDto, NodeItem, SettingsInput, TransferResult } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { nameError, uniqName } from "@/domain/names";
import { isExpiryOption, nextExpiry } from "@/domain/share";
import { normalizeTag } from "@/domain/tags";
import { db, Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import {
  accountUsage,
  addLinkEvent,
  ancestorChain,
  deleteNodes,
  descendantIds,
  findNode,
  findNodes,
  findRootFolder,
  inheritVisibilityBelow,
  insertNodes,
  listLinkEvents,
  listSiblingNames,
  subtreeRows,
  updateNode,
  type NodeRow,
} from "../repositories/node.repo";
import type { StorageLocation } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { toNodeItem } from "./node.service";
import { driverForAccount } from "./volume.service";

type Owner = Pick<AccountRow, "id" | "volumeId" | "isAdmin" | "quotaBytes">;

/** Link activity entries returned to the owner (the database keeps 200 per item). */
const ACTIVITY_LIMIT = 200;
/** Tags one item can carry. */
const MAX_TAGS_PER_ITEM = 20;

/** Storage location of a node: its folder names below the account root. */
async function locationOf(accountId: string, nodeId: string): Promise<StorageLocation> {
  const chain = await ancestorChain(db(), nodeId);
  return { accountId, segments: chain.slice(1).map((row) => row.name) };
}

async function requireNode(accountId: string, nodeId: string): Promise<NodeRow> {
  const row = await findNode(db(), accountId, nodeId);
  if (!row) throw new ApiError("NOT_FOUND");
  return row;
}

async function requireFolder(accountId: string, ref: string): Promise<NodeRow> {
  const row = ref === "root" ? await findRootFolder(db(), accountId) : await findNode(db(), accountId, ref);
  if (!row || row.type !== "FOLDER") throw new ApiError("NOT_FOUND");
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Renames in the database and on disk; a taken name is refused with a suggestion (design wording). */
export async function renameNode(owner: Owner, nodeId: string, requested: string): Promise<NodeItem> {
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

/** True when `nodeId` is the folder or inside it. */
function isInside(chainIds: string[], nodeId: string): boolean {
  return chainIds.includes(nodeId);
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
 * Moves items into a folder (design `move`): items already there, the target itself and
 * anything that would land inside itself are skipped; clashing names get "Name (2)".
 */
export async function moveNodes(owner: Owner, ids: string[], targetRef: string): Promise<TransferResult> {
  const target = await requireFolder(owner.id, targetRef);
  const targetChain = await ancestorChain(db(), target.id);
  const targetIds = targetChain.map((row) => row.id);
  const items = (await topLevel(owner.id, ids)).filter((row) => row.id !== target.id && row.parentId !== target.id && !isInside(targetIds, row.id));
  if (items.length === 0) throw new ApiError("BAD_REQUEST", "Can't move there");

  const driver = await driverForAccount(owner, "write");
  const targetSegments = targetChain.slice(1).map((row) => row.name);
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
 * Copies items with everything inside (design `copyTo`): new ids and links, zero
 * downloads, settings and tags kept. Bytes are copied on the volume (reflink when possible).
 */
export async function copyNodes(owner: Owner, ids: string[], targetRef: string): Promise<TransferResult> {
  const target = await requireFolder(owner.id, targetRef);
  const targetChain = await ancestorChain(db(), target.id);
  const items = (await topLevel(owner.id, ids)).filter((row) => !isInside(targetChain.map((ancestor) => ancestor.id), row.id));
  if (items.length === 0) throw new ApiError("BAD_REQUEST", "Can't copy there");

  const trees = await Promise.all(items.map((row) => subtreeRows(db(), row.id)));
  const bytes = trees.flat().reduce((sum, row) => sum + (row.type === "FILE" ? row.size : 0n), 0n);
  if (owner.quotaBytes !== null) {
    const { usedBytes } = await accountUsage(db(), owner.id);
    if (usedBytes + bytes > owner.quotaBytes) throw new ApiError("INSUFFICIENT_STORAGE", "Not enough space in this account for the copy.");
  }

  const driver = await driverForAccount(owner, "write");
  const targetSegments = targetChain.slice(1).map((row) => row.name);
  const taken = await listSiblingNames(db(), target.id);
  let renamed = 0;
  const now = new Date();
  const copies = await Promise.all(items.map(async (row) => ({ row, from: await locationOf(owner.id, row.id) })));
  const media: string[] = [];

  await withStorageTransaction(db(), async (tx, undo) => {
    for (const [index, { row, from }] of copies.entries()) {
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
          createdAt: now,
          updatedAt: now,
        } satisfies Prisma.NodeCreateManyInput;
      });
      await insertNodes(tx, rows);
      const to = { accountId: owner.id, segments: [...targetSegments, name] };
      await driver.copy(from, to);
      undo.push("remove copy", async () => {
        await driver.moveToTrash(to);
      });
      media.push(...rows.filter((copy) => copy.type === "FILE" && (copy.kind === "IMAGE" || copy.kind === "VIDEO")).map((copy) => copy.id));
    }
  });
  // Assets are keyed by node id, so copies get their own (rebuilt by the worker).
  void enqueueMedia(media);
  return { done: items.length, renamed, targetName: target.name };
}

/** Deletes items with everything inside; files go to the volume's trash for the purge job. */
export async function deleteItems(owner: Owner, ids: string[]): Promise<{ deleted: number }> {
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
  });
  // Thumbnails and stripped copies are rebuilt on demand, so they are removed right away.
  await driver.removeAssets(owner.id, files.map((row) => row.id)).catch((error: unknown) => logger.warn("assets not removed", { error }));
  return { deleted: items.length };
}

/** Adds and removes tags on one or many items (the tags dialog edits common tags in bulk). */
export async function updateTags(owner: Owner, ids: string[], add: string[], remove: string[]): Promise<{ updated: number }> {
  const adding = [...new Set(add.map(normalizeTag).filter(Boolean))];
  const removing = new Set(remove.map(normalizeTag));
  const rows = await findNodes(db(), owner.id, [...new Set(ids)]);
  if (rows.length === 0) throw new ApiError("NOT_FOUND");
  await db().$transaction(async (tx) => {
    for (const row of rows) {
      const tags = [...new Set([...row.tags.filter((tag) => !removing.has(tag)), ...adding])];
      if (tags.length > MAX_TAGS_PER_ITEM) throw new ApiError("BAD_REQUEST", `An item can have at most ${MAX_TAGS_PER_ITEM} tags.`);
      await updateNode(tx, row.id, { tags });
    }
  });
  return { updated: rows.length };
}

const VISIBILITY = { inherit: "INHERIT", private: "PRIVATE", public: "PUBLIC" } as const;

/**
 * Saves share settings (design `saveSettings`). Only admins change expiry and
 * delete-after-download; members' items are deleted with their account.
 */
export async function updateSettings(owner: Owner, nodeId: string, input: SettingsInput): Promise<NodeItem> {
  const row = await requireNode(owner.id, nodeId);
  const isRoot = row.parentId === null;
  const data: Prisma.NodeUpdateInput = {
    visibility: VISIBILITY[isRoot && input.visibility === "inherit" ? "private" : input.visibility],
    downloadLimit: input.downloadLimit,
    access: input.access === "stream" ? "STREAM" : "BOTH",
    note: input.note.trim(),
  };
  if (owner.isAdmin) {
    if (!isExpiryOption(input.expiry)) throw new ApiError("BAD_REQUEST", "Unknown expiry.", { fields: { expiry: "Unknown expiry." } });
    const expAt = nextExpiry({ expiry: row.expiryLabel, expAt: row.expAt?.getTime() ?? null }, input.expiry, Date.now());
    data.expiryLabel = input.expiry;
    data.expAt = expAt === null ? null : new Date(expAt);
    data.burn = input.burn;
  }
  if (input.password !== undefined) data.passwordHash = input.password === "" ? null : await hash(input.password);

  const updated = await db().$transaction(async (tx) => {
    const result = await updateNode(tx, row.id, data);
    if (input.applyDown && row.type === "FOLDER") await inheritVisibilityBelow(tx, row.id);
    return result;
  });
  return toNodeItem(updated);
}

/** Replaces the share link; the old one stops working at once (design `regenLink`). */
export async function regenerateLink(owner: Owner, nodeId: string): Promise<NodeItem> {
  const row = await requireNode(owner.id, nodeId);
  const updated = await db().$transaction(async (tx) => {
    const result = await updateNode(tx, row.id, { linkId: newLinkId() });
    await addLinkEvent(tx, { nodeId: row.id, kind: "RESET", fileName: row.name });
    return result;
  });
  return toNodeItem(updated);
}

/** Link activity of an item; a folder's log also lists activity on everything inside it. */
export async function linkActivity(owner: Owner, nodeId: string): Promise<LinkEventDto[]> {
  const row = await requireNode(owner.id, nodeId);
  const ids = row.type === "FOLDER" ? [row.id, ...(await descendantIds(db(), row.id))] : [row.id];
  const events = await listLinkEvents(db(), ids, ACTIVITY_LIMIT);
  return events.map((event) => ({ ...event, kind: event.kind.toLowerCase() as LinkEventDto["kind"], at: event.at.toISOString() }));
}

/** Admin switch that stops downloads of an item ("Downloads paused"). */
export async function setDownloadsPaused(owner: Owner, nodeId: string, paused: boolean): Promise<NodeItem> {
  if (!owner.isAdmin) throw new ApiError("FORBIDDEN");
  const row = await requireNode(owner.id, nodeId);
  return toNodeItem(await updateNode(db(), row.id, { dlPaused: paused }));
}
