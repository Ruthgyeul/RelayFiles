import "server-only";
import type { DbClient, Prisma } from "../db/client";

/** A collection's own columns (its items are read separately, in order). */
const COLLECTION_SELECT = {
  id: true,
  accountId: true,
  linkId: true,
  name: true,
  note: true,
  expiryLabel: true,
  expAt: true,
  burn: true,
  downloadLimit: true,
  downloads: true,
  passwordHash: true,
  access: true,
  createdAt: true,
} satisfies Prisma.ShareCollectionSelect;

export type CollectionRow = Prisma.ShareCollectionGetPayload<{ select: typeof COLLECTION_SELECT }>;
export type CollectionWithItems = CollectionRow & { nodeIds: string[] };

const withItems = { ...COLLECTION_SELECT, items: { select: { nodeId: true }, orderBy: { position: "asc" } } } satisfies Prisma.ShareCollectionSelect;

function flatten(row: Prisma.ShareCollectionGetPayload<{ select: typeof withItems }> | null): CollectionWithItems | null {
  if (!row) return null;
  const { items, ...collection } = row;
  return { ...collection, nodeIds: items.map((item) => item.nodeId) };
}

/** The collection a share link id belongs to, with its items in order; null when none has it. */
export async function findCollectionByLinkId(db: DbClient, linkId: string): Promise<CollectionWithItems | null> {
  return flatten(await db.shareCollection.findUnique({ where: { linkId }, select: withItems }));
}

/** One of the account's collections; null when it is not the account's (or gone). */
export async function findCollection(db: DbClient, accountId: string, id: string): Promise<CollectionWithItems | null> {
  return flatten(await db.shareCollection.findFirst({ where: { id, accountId }, select: withItems }));
}

/** The account's collections, newest first, with their items in order. */
export async function listCollections(db: DbClient, accountId: string): Promise<CollectionWithItems[]> {
  const rows = await db.shareCollection.findMany({ where: { accountId }, select: withItems, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return rows.map((row) => flatten(row)!);
}

export function countCollections(db: DbClient, accountId: string): Promise<number> {
  return db.shareCollection.count({ where: { accountId } });
}

/** Whether a share link id is in use: by an item, a collection, or a link that ended (never handed out again). */
export async function linkIdTaken(db: DbClient, linkId: string): Promise<boolean> {
  const [node, collection, retired] = await Promise.all([
    db.node.count({ where: { linkId } }),
    db.shareCollection.count({ where: { linkId } }),
    db.linkTombstone.count({ where: { linkId } }),
  ]);
  return node + collection + retired > 0;
}

export function createCollection(db: DbClient, data: Prisma.ShareCollectionUncheckedCreateInput) {
  return db.shareCollection.create({ data, select: COLLECTION_SELECT });
}

export function updateCollection(db: DbClient, id: string, data: Prisma.ShareCollectionUncheckedUpdateInput) {
  return db.shareCollection.update({ where: { id }, data, select: COLLECTION_SELECT });
}

/** Replaces a collection's items with these nodes, in this order. */
export async function setCollectionItems(db: DbClient, collectionId: string, nodeIds: readonly string[]): Promise<void> {
  await db.shareCollectionItem.deleteMany({ where: { collectionId } });
  await db.shareCollectionItem.createMany({ data: nodeIds.map((nodeId, position) => ({ collectionId, nodeId, position })) });
}

/** Deletes one of the account's collections; 0 when it is not the account's (or gone). */
export async function deleteCollection(db: DbClient, accountId: string, id: string): Promise<number> {
  return (await db.shareCollection.deleteMany({ where: { id, accountId } })).count;
}

/** Deletes every collection of the account ("Make all private" in Shared by me). */
export async function deleteCollectionsOf(db: DbClient, accountId: string): Promise<number> {
  return (await db.shareCollection.deleteMany({ where: { accountId } })).count;
}

/** A node's place in a collection, kept in Recently deleted to put it back on restore. */
export interface CollectionPlace {
  collectionId: string;
  position: number;
}

/** The collections each of these nodes is in (nodes in none are absent). */
export async function collectionPlacesOf(db: DbClient, nodeIds: readonly string[]): Promise<Map<string, CollectionPlace[]>> {
  const rows = await db.shareCollectionItem.findMany({ where: { nodeId: { in: [...nodeIds] } }, select: { nodeId: true, collectionId: true, position: true } });
  const places = new Map<string, CollectionPlace[]>();
  for (const { nodeId, ...place } of rows) places.set(nodeId, [...(places.get(nodeId) ?? []), place]);
  return places;
}

/** Puts restored nodes back into those of their collections the account still has. */
export async function relistCollectionItems(db: DbClient, accountId: string, entries: readonly (CollectionPlace & { nodeId: string })[]): Promise<void> {
  if (entries.length === 0) return;
  const existing = await db.shareCollection.findMany({ where: { accountId, id: { in: [...new Set(entries.map((entry) => entry.collectionId))] } }, select: { id: true } });
  const kept = new Set(existing.map((row) => row.id));
  await db.shareCollectionItem.createMany({ data: entries.filter((entry) => kept.has(entry.collectionId)), skipDuplicates: true });
}
