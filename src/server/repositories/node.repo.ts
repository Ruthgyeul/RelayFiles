import "server-only";
import type { DbClient } from "../db/client";

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

/** Columns the File Manager shows (password hash only as a flag). */
export const NODE_SELECT = {
  id: true,
  accountId: true,
  parentId: true,
  type: true,
  name: true,
  kind: true,
  size: true,
  hasThumb: true,
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

/** Every folder of an account (id, name, parent) to build paths. */
export function listFolders(db: DbClient, accountId: string) {
  return db.node.findMany({ where: { accountId, type: "FOLDER" }, select: { id: true, name: true, parentId: true, visibility: true } });
}

export interface AncestorRow {
  id: string;
  name: string;
  visibility: "INHERIT" | "PRIVATE" | "PUBLIC";
}

/** The chain from the account root down to `nodeId` (inclusive). */
export async function ancestorChain(db: DbClient, nodeId: string): Promise<AncestorRow[]> {
  const rows = await db.$queryRaw<(AncestorRow & { depth: number })[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId", name, visibility, 0 AS depth FROM "Node" WHERE id = ${nodeId}
      UNION ALL
      SELECT n.id, n."parentId", n.name, n.visibility, c.depth + 1 FROM "Node" n JOIN chain c ON n.id = c."parentId"
    )
    SELECT id, name, visibility::text AS visibility, depth FROM chain ORDER BY depth DESC`;
  return rows.map(({ id, name, visibility }) => ({ id, name, visibility }));
}

/** Direct child counts for folders. */
export async function childCounts(db: DbClient, parentIds: string[]): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await db.node.groupBy({ by: ["parentId"], where: { parentId: { in: parentIds } }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.parentId!, row._count._all]));
}

/** Total file bytes below each folder (recursive). */
export async function folderSizes(db: DbClient, folderIds: string[]): Promise<Map<string, bigint>> {
  if (folderIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: string; size: bigint }[]>`
    WITH RECURSIVE sub AS (
      SELECT id AS top, id FROM "Node" WHERE id = ANY(${folderIds})
      UNION ALL
      SELECT s.top, n.id FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT s.top AS id, COALESCE(SUM(n.size), 0)::bigint AS size
    FROM sub s JOIN "Node" n ON n.id = s.id AND n.type = 'FILE'
    GROUP BY s.top`;
  return new Map(rows.map((row) => [row.id, BigInt(row.size)]));
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

/** Files and folders anywhere below a folder. */
export async function descendantCounts(db: DbClient, folderId: string): Promise<{ files: number; folders: number }> {
  const [row] = await db.$queryRaw<{ files: bigint; folders: bigint }[]>`
    WITH RECURSIVE sub AS (
      SELECT id, type FROM "Node" WHERE "parentId" = ${folderId}
      UNION ALL
      SELECT n.id, n.type FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT COUNT(*) FILTER (WHERE type = 'FILE') AS files, COUNT(*) FILTER (WHERE type = 'FOLDER') AS folders FROM sub`;
  return { files: Number(row?.files ?? 0), folders: Number(row?.folders ?? 0) };
}
