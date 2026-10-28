import "server-only";
import { hash } from "@node-rs/argon2";
import { FILES, SHARE } from "@/config/policy";
import type { LinkEventDto, NodeItem, SettingsInput } from "@/contracts/nodes";
import { newLinkId } from "@/domain/ids";
import { isExpiryOption, nextExpiry } from "@/domain/share";
import { normalizeTag } from "@/domain/tags";
import { db, type Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import { addLinkEvent, listLinkEvents } from "../repositories/link-event.repo";
import { findNodes, updateNode } from "../repositories/node.repo";
import { descendantIds, inheritVisibilityBelow } from "../repositories/node-tree.repo";
import { requireNode, type NodeOwner } from "./node-ops.service";
import { toNodeItem } from "./node.service";

/** Adds and removes tags on one or many items (the tags dialog edits common tags in bulk). */
export async function updateTags(owner: NodeOwner, ids: string[], add: string[], remove: string[]): Promise<{ updated: number }> {
  const adding = [...new Set(add.map(normalizeTag).filter(Boolean))];
  const removing = new Set(remove.map(normalizeTag));
  const rows = await findNodes(db(), owner.id, [...new Set(ids)]);
  if (rows.length === 0) throw new ApiError("NOT_FOUND");
  await db().$transaction(async (tx) => {
    for (const row of rows) {
      const tags = [...new Set([...row.tags.filter((tag) => !removing.has(tag)), ...adding])];
      if (tags.length > FILES.maxTagsPerItem) throw new ApiError("BAD_REQUEST", `An item can have at most ${FILES.maxTagsPerItem} tags.`);
      await updateNode(tx, row.id, { tags });
    }
  });
  return { updated: rows.length };
}

const VISIBILITY = { inherit: "INHERIT", private: "PRIVATE", public: "PUBLIC" } as const;

/**
 * Saves share settings. Only admins change expiry and
 * delete-after-download; members' items are deleted with their account.
 */
export async function updateSettings(owner: NodeOwner, nodeId: string, input: SettingsInput): Promise<NodeItem> {
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

/** Replaces the share link; the old one stops working at once. */
export async function regenerateLink(owner: NodeOwner, nodeId: string): Promise<NodeItem> {
  const row = await requireNode(owner.id, nodeId);
  const updated = await db().$transaction(async (tx) => {
    const result = await updateNode(tx, row.id, { linkId: newLinkId() });
    await addLinkEvent(tx, { nodeId: row.id, kind: "RESET", fileName: row.name });
    return result;
  });
  return toNodeItem(updated);
}

/** Link activity of an item; a folder's log also lists activity on everything inside it. */
export async function linkActivity(owner: NodeOwner, nodeId: string): Promise<LinkEventDto[]> {
  const row = await requireNode(owner.id, nodeId);
  const ids = row.type === "FOLDER" ? [row.id, ...(await descendantIds(db(), row.id))] : [row.id];
  const events = await listLinkEvents(db(), ids, SHARE.activityListLimit);
  return events.map((event) => ({ ...event, kind: event.kind.toLowerCase() as LinkEventDto["kind"], at: event.at.toISOString() }));
}

/** Admin switch that stops downloads of an item ("Downloads paused"). */
export async function setDownloadsPaused(owner: NodeOwner, nodeId: string, paused: boolean): Promise<NodeItem> {
  if (!owner.isAdmin) throw new ApiError("FORBIDDEN");
  const row = await requireNode(owner.id, nodeId);
  return toNodeItem(await updateNode(db(), row.id, { dlPaused: paused }));
}
