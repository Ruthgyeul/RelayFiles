import "server-only";
import type { DbClient } from "../db/client";

// Recursive queries over a folder tree (WITH RECURSIVE on Node.parentId).

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

/** Total file bytes and file count below each folder (recursive). */
export async function folderSizes(db: DbClient, folderIds: string[]): Promise<Map<string, { size: bigint; files: number }>> {
  if (folderIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: string; size: bigint; files: bigint }[]>`
    WITH RECURSIVE sub AS (
      SELECT id AS top, id FROM "Node" WHERE id = ANY(${folderIds})
      UNION ALL
      SELECT s.top, n.id FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT s.top AS id, COALESCE(SUM(n.size), 0)::bigint AS size, COUNT(n.id)::bigint AS files
    FROM sub s JOIN "Node" n ON n.id = s.id AND n.type = 'FILE'
    GROUP BY s.top`;
  return new Map(rows.map((row) => [row.id, { size: BigInt(row.size), files: Number(row.files) }]));
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

/** Ids of every node below a folder (not including it). */
export async function descendantIds(db: DbClient, folderId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Node" WHERE "parentId" = ${folderId}
      UNION ALL
      SELECT n.id FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT id FROM sub`;
  return rows.map((row) => row.id);
}

/** Full rows of a node and everything below it, parents before children (for copying). */
export async function subtreeRows(db: DbClient, nodeId: string) {
  const ids = [nodeId, ...(await descendantIds(db, nodeId))];
  const rows = await db.node.findMany({ where: { id: { in: ids } } });
  const order = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** "Apply to all subfolders and files": everything inside follows the folder again. */
export async function inheritVisibilityBelow(db: DbClient, folderId: string): Promise<void> {
  const ids = await descendantIds(db, folderId);
  if (ids.length) await db.node.updateMany({ where: { id: { in: ids } }, data: { visibility: "INHERIT" } });
}

/** Every node below a folder with its path relative to it ("Photos/a.jpg"). */
export async function relativePaths(db: DbClient, folderId: string): Promise<Map<string, { id: string; type: "FILE" | "FOLDER" }>> {
  const rows = await db.$queryRaw<{ id: string; path: string; type: "FILE" | "FOLDER" }[]>`
    WITH RECURSIVE sub AS (
      SELECT id, name::text AS path, type FROM "Node" WHERE "parentId" = ${folderId}
      UNION ALL
      SELECT n.id, s.path || '/' || n.name, n.type FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT id, path, type::text AS type FROM sub`;
  return new Map(rows.map((row) => [row.path, { id: row.id, type: row.type }]));
}

/** Every item below a folder with its path, size and "missing" flag (npm run storage:fsck). */
export function treeEntries(db: DbClient, folderId: string) {
  return db.$queryRaw<{ id: string; path: string; type: "FILE" | "FOLDER"; size: bigint; missing: boolean }[]>`
    WITH RECURSIVE sub AS (
      SELECT id, name::text AS path FROM "Node" WHERE "parentId" = ${folderId}
      UNION ALL
      SELECT n.id, s.path || '/' || n.name FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT n.id, sub.path, n.type::text AS type, n.size, n.missing FROM sub JOIN "Node" n ON n.id = sub.id`;
}
