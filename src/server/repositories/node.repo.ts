import "server-only";
import { MEDIA } from "@/config/policy";
import type { DbClient, Prisma } from "../db/client";

/** Name of every account's root folder; it maps to users/<accountId>/ on the volume. */
export const ROOT_FOLDER_NAME = "root";

export async function createRootFolder(db: DbClient, data: { id: string; accountId: string; linkId: string }): Promise<void> {
  await db.node.create({ data: { ...data, parentId: null, type: "FOLDER", name: ROOT_FOLDER_NAME } });
}

/** Bytes stored by an account (sum of file sizes) and the number of items in its root folder. */
export async function accountUsage(db: DbClient, accountId: string): Promise<{ usedBytes: bigint; rootItems: number }> {
  const [sum, rootItems] = await Promise.all([
    db.node.aggregate({ where: { accountId, type: "FILE" }, _sum: { size: true } }),
    db.node.count({ where: { accountId, parent: { parentId: null, accountId } } }),
  ]);
  return { usedBytes: sum._sum.size ?? 0n, rootItems };
}

/** Files and folders of an account, its root folder included. */
export function countItems(db: DbClient, accountId: string): Promise<number> {
  return db.node.count({ where: { accountId } });
}

/** Bytes stored by all anonymous (non-admin) accounts, for ANON_TOTAL_QUOTA_GB. */
export async function anonUsage(db: DbClient): Promise<bigint> {
  const sum = await db.node.aggregate({ where: { type: "FILE", account: { isAdmin: false } }, _sum: { size: true } });
  return sum._sum.size ?? 0n;
}

/** Columns the File Manager shows (password hash only as a flag). */
export const NODE_SELECT = {
  id: true,
  accountId: true,
  parentId: true,
  type: true,
  name: true,
  kind: true,
  mime: true,
  size: true,
  sha256: true,
  hasThumb: true,
  hasDerived: true,
  linkId: true,
  visibility: true,
  expiryLabel: true,
  expAt: true,
  burn: true,
  downloadLimit: true,
  passwordHash: true,
  access: true,
  note: true,
  dlPaused: true,
  downloads: true,
  tags: true,
  createdAt: true,
} as const;

export type NodeRow = NonNullable<Awaited<ReturnType<typeof findNode>>>;

export function findNode(db: DbClient, accountId: string, nodeId: string) {
  return db.node.findFirst({ where: { id: nodeId, accountId }, select: NODE_SELECT });
}

/** A node by id for background jobs (no account scope: the caller is the server itself). */
export function findNodeForJob(db: DbClient, nodeId: string) {
  return db.node.findUnique({ where: { id: nodeId }, select: NODE_SELECT });
}

/** Images and videos still without a thumbnail, oldest first, for the backfill script. */
export function mediaWithoutThumbs(db: DbClient, take: number, afterId?: string) {
  return db.node.findMany({
    where: { type: "FILE", kind: { in: ["IMAGE", "VIDEO"] }, hasThumb: false, missing: false },
    select: { id: true },
    orderBy: { id: "asc" },
    take,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });
}

/** Images large enough for a viewer preview, oldest first, for `media:backfill -- --previews`. */
export function imagesForPreview(db: DbClient, take: number, afterId?: string) {
  return db.node.findMany({
    where: { type: "FILE", kind: "IMAGE", missing: false, size: { gte: MEDIA.previewMinBytes }, mime: { in: [...MEDIA.previewTypes] } },
    select: { id: true },
    orderBy: { id: "asc" },
    take,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });
}

export function findRootFolder(db: DbClient, accountId: string) {
  return db.node.findFirst({ where: { accountId, parentId: null }, select: NODE_SELECT });
}

export function listChildren(db: DbClient, parentId: string) {
  return db.node.findMany({ where: { parentId }, select: NODE_SELECT });
}

export function listSiblingNames(db: DbClient, parentId: string): Promise<string[]> {
  return db.node.findMany({ where: { parentId }, select: { name: true } }).then((rows) => rows.map((row) => row.name));
}

/** Nodes carrying every tag, anywhere in the account (the root never has tags). */
export function findByTags(db: DbClient, accountId: string, tags: string[], limit: number) {
  return db.node.findMany({ where: { accountId, parentId: { not: null }, tags: { hasEvery: tags } }, select: NODE_SELECT, take: limit });
}

/** Items whose name contains `text` (any case), outside the account root. */
export function findByName(db: DbClient, accountId: string, text: string, limit: number) {
  return db.node.findMany({ where: { accountId, parentId: { not: null }, name: { contains: text, mode: "insensitive" } }, select: NODE_SELECT, take: limit });
}

/** The newest files of an account. */
export function recentFiles(db: DbClient, accountId: string, limit: number) {
  return db.node.findMany({ where: { accountId, type: "FILE" }, orderBy: { createdAt: "desc" }, select: NODE_SELECT, take: limit });
}

/** Every folder of an account (id, name, parent) to build paths. */
export function listFolders(db: DbClient, accountId: string) {
  return db.node.findMany({ where: { accountId, type: "FOLDER" }, select: { id: true, name: true, parentId: true, visibility: true } });
}

/** Direct child counts for folders. */
export async function childCounts(db: DbClient, parentIds: string[]): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await db.node.groupBy({ by: ["parentId"], where: { parentId: { in: parentIds } }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.parentId!, row._count._all]));
}

/** Tags used in an account with how many items carry each, most used first. */
export function tagUsage(db: DbClient, accountId: string): Promise<{ tag: string; count: number }[]> {
  return db.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT tag, COUNT(*)::bigint AS count FROM "Node", unnest(tags) AS tag
    WHERE "accountId" = ${accountId} GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 100`.then((rows) => rows.map((row) => ({ tag: row.tag, count: Number(row.count) })));
}

export interface NewFolder {
  id: string;
  accountId: string;
  parentId: string;
  name: string;
  linkId: string;
}

export function createFolderNode(db: DbClient, data: NewFolder) {
  return db.node.create({ data: { ...data, type: "FOLDER" }, select: NODE_SELECT });
}

export function findNodes(db: DbClient, accountId: string, ids: string[]) {
  return db.node.findMany({ where: { accountId, id: { in: ids } }, select: NODE_SELECT });
}

export function updateNode(db: DbClient, nodeId: string, data: Prisma.NodeUpdateInput) {
  return db.node.update({ where: { id: nodeId }, data, select: NODE_SELECT });
}

export async function deleteNodes(db: DbClient, ids: string[]): Promise<void> {
  await db.node.deleteMany({ where: { id: { in: ids } } });
}

export async function insertNodes(db: DbClient, rows: Prisma.NodeCreateManyInput[]): Promise<void> {
  await db.node.createMany({ data: rows });
}

/** A child with this exact name, if any. */
export function findChildByName(db: DbClient, parentId: string, name: string) {
  return db.node.findFirst({ where: { parentId, name }, select: NODE_SELECT });
}

/** Marks files found missing on disk (or found again). */
export async function setMissing(db: DbClient, ids: readonly string[], missing: boolean): Promise<void> {
  if (ids.length === 0) return;
  await db.node.updateMany({ where: { id: { in: [...ids] }, type: "FILE" }, data: { missing } });
}

export interface NewFile {
  id: string;
  accountId: string;
  parentId: string;
  name: string;
  kind: "VIDEO" | "AUDIO" | "IMAGE" | "OTHER";
  mime: string;
  size: bigint;
  sha256: string;
  linkId: string;
}

export function createFileNode(db: DbClient, data: NewFile) {
  return db.node.create({ data: { ...data, type: "FILE" }, select: NODE_SELECT });
}

/** Files and folders of an account (the root folder is not counted). */
export async function contentCounts(db: DbClient, accountId: string): Promise<{ files: number; folders: number }> {
  const rows = await db.node.groupBy({ by: ["type"], where: { accountId, parentId: { not: null } }, _count: { _all: true } });
  const count = (type: "FILE" | "FOLDER") => rows.find((row) => row.type === type)?._count._all ?? 0;
  return { files: count("FILE"), folders: count("FOLDER") };
}

/** Items past their own expiry, or delete-after-download items that were downloaded. */
export function expiredItemIds(db: DbClient, accountId: string | null, now: Date) {
  return db.node.findMany({
    where: { ...(accountId ? { accountId } : {}), parentId: { not: null }, OR: [{ expAt: { lte: now } }, { burn: true, downloads: { gte: 1 } }] },
    select: { id: true, accountId: true },
  });
}

/** A file of the account with this content and size, other than `exceptId` (deduplication of a re-upload). */
export function findFileWithContent(db: DbClient, accountId: string, sha256: string, size: bigint, exceptId: string | null) {
  return db.node.findFirst({
    where: { accountId, type: "FILE", sha256, size, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}
