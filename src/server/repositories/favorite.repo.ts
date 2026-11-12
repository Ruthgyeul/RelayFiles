import "server-only";
import type { DbClient } from "../db/client";
import { NODE_SELECT } from "./node.repo";

/**
 * Favorites (docs/architecture.md "즐겨찾기"): a virtual folder listing items where they are.
 * Every change runs under lockFavoritesOf so limits, sibling names and cycles are checked
 * against a state no other request is changing.
 */
export async function lockFavoritesOf(tx: DbClient, accountId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`favorites:${accountId}`}))`;
}

/** Every organizing folder of an account (at most FILES.maxFavoriteFolders), to build paths in memory. */
export function listFavoriteFolders(db: DbClient, accountId: string) {
  return db.favoriteFolder.findMany({ where: { accountId }, select: { id: true, parentId: true, name: true }, orderBy: { name: "asc" } });
}

export function createFavoriteFolder(db: DbClient, data: { id: string; accountId: string; parentId: string | null; name: string }) {
  return db.favoriteFolder.create({ data, select: { id: true, parentId: true, name: true } });
}

export function updateFavoriteFolder(db: DbClient, accountId: string, id: string, data: { name?: string; parentId?: string | null }) {
  return db.favoriteFolder.updateMany({ where: { accountId, id }, data });
}

/** Deletes folders; their subfolders go with them (cascade) and their favorites lose the folder (set null). */
export function deleteFavoriteFolders(db: DbClient, accountId: string, ids: string[]) {
  return db.favoriteFolder.deleteMany({ where: { accountId, id: { in: ids } } });
}

/** Favorites listed directly in one organizing folder (null: the top of Favorites), newest first. */
export function favoritesIn(db: DbClient, accountId: string, folderId: string | null) {
  return db.favorite.findMany({ where: { accountId, folderId }, orderBy: { createdAt: "desc" }, select: { node: { select: NODE_SELECT } } }).then((rows) => rows.map((row) => row.node));
}

/** Where each of these items is listed in Favorites (absent: not a favorite). */
export async function favoriteFoldersOf(db: DbClient, nodeIds: readonly string[]): Promise<Map<string, string | null>> {
  if (nodeIds.length === 0) return new Map();
  const rows = await db.favorite.findMany({ where: { nodeId: { in: [...nodeIds] } }, select: { nodeId: true, folderId: true } });
  return new Map(rows.map((row) => [row.nodeId, row.folderId]));
}

export function countFavorites(db: DbClient, accountId: string): Promise<number> {
  return db.favorite.count({ where: { accountId } });
}

/** Favorites and subfolders directly inside each organizing folder (the top of Favorites under null). */
export async function favoriteFolderCounts(db: DbClient, accountId: string): Promise<Map<string | null, number>> {
  const [favorites, folders] = await Promise.all([
    db.favorite.groupBy({ by: ["folderId"], where: { accountId }, _count: { _all: true } }),
    db.favoriteFolder.groupBy({ by: ["parentId"], where: { accountId }, _count: { _all: true } }),
  ]);
  const counts = new Map<string | null, number>();
  for (const row of favorites) counts.set(row.folderId, (counts.get(row.folderId) ?? 0) + row._count._all);
  for (const row of folders) counts.set(row.parentId, (counts.get(row.parentId) ?? 0) + row._count._all);
  return counts;
}

export function countFavoritesIn(db: DbClient, accountId: string, folderIds: string[]): Promise<number> {
  return db.favorite.count({ where: { accountId, folderId: { in: folderIds } } });
}

export function addFavorites(db: DbClient, rows: { id: string; accountId: string; nodeId: string; folderId: string | null }[]) {
  return db.favorite.createMany({ data: rows, skipDuplicates: true });
}

export function removeFavorites(db: DbClient, accountId: string, nodeIds: string[]) {
  return db.favorite.deleteMany({ where: { accountId, nodeId: { in: nodeIds } } });
}

export function removeFavoritesIn(db: DbClient, accountId: string, folderIds: string[]) {
  return db.favorite.deleteMany({ where: { accountId, folderId: { in: folderIds } } });
}

export function moveFavorites(db: DbClient, accountId: string, nodeIds: string[], folderId: string | null) {
  return db.favorite.updateMany({ where: { accountId, nodeId: { in: nodeIds } }, data: { folderId } });
}

export function moveFavoritesOutOf(db: DbClient, accountId: string, fromFolderId: string, toFolderId: string | null) {
  return db.favorite.updateMany({ where: { accountId, folderId: fromFolderId }, data: { folderId: toFolderId } });
}

/** A replaced file gets a new node id; its favorite moves to the new row. */
export function moveFavoriteToNode(db: DbClient, fromNodeId: string, toNodeId: string) {
  return db.favorite.updateMany({ where: { nodeId: fromNodeId }, data: { nodeId: toNodeId } });
}
