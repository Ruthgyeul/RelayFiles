import "server-only";
import { Prisma, type DbClient } from "../db/client";

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

/** What one item directly inside a folder holds (a file: itself). */
export interface ChildStats {
  /** File bytes in it at any depth (a file: its size). */
  size: bigint;
  /** Files in it at any depth (a file: 1). */
  files: number;
  /** Items directly inside it (a file: 0). */
  items: number;
}

/**
 * {@link ChildStats} of every item directly inside a folder, from one walk of the folder's tree
 * grouped by the item each node is under (not one walk per child folder). `open` is a condition
 * on "Node" n that limits the walk: nodes that fail it are neither entered nor counted.
 */
export async function childStats(db: DbClient, folderId: string, open: Prisma.Sql = Prisma.sql`TRUE`): Promise<Map<string, ChildStats>> {
  const rows = await db.$queryRaw<{ id: string; size: bigint; files: bigint; items: bigint }[]>`
    WITH RECURSIVE sub AS (
      SELECT n.id AS top, n.id, n.type, n.size, 0 AS depth FROM "Node" n WHERE n."parentId" = ${folderId} AND ${open}
      UNION ALL
      SELECT s.top, n.id, n.type, n.size, s.depth + 1 FROM "Node" n JOIN sub s ON n."parentId" = s.id
      WHERE s.type = 'FOLDER' AND ${open}
    )
    SELECT top AS id, COALESCE(SUM(size) FILTER (WHERE type = 'FILE'), 0)::bigint AS size,
           COUNT(*) FILTER (WHERE type = 'FILE')::bigint AS files, COUNT(*) FILTER (WHERE depth = 1)::bigint AS items
    FROM sub GROUP BY top`;
  return new Map(rows.map((row) => [row.id, { size: BigInt(row.size), files: Number(row.files), items: Number(row.items) }]));
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

/** A folder and every folder below it, with paths relative to it ("" for the folder itself). */
export function folderPathsBelow(db: DbClient, folderId: string) {
  return db.$queryRaw<{ id: string; path: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id, ''::text AS path FROM "Node" WHERE id = ${folderId} AND type = 'FOLDER'
      UNION ALL
      SELECT n.id, CASE WHEN s.path = '' THEN n.name::text ELSE s.path || '/' || n.name END FROM "Node" n JOIN sub s ON n."parentId" = s.id WHERE n.type = 'FOLDER'
    )
    SELECT id, path FROM sub`;
}

/**
 * Locks items and everything below them FOR UPDATE inside a transaction and returns those rows,
 * so a delete counts exactly the files it removes: nothing can be added below a locked folder
 * (the foreign key check waits), moved out or renamed until the transaction ends. The tree is
 * read again after each lock until no new row appears; null when it kept changing for `attempts`.
 * Rows are locked from the top down, the order {@link lockAncestorChain} uses too.
 */
export async function lockSubtrees(tx: DbClient, topIds: readonly string[], attempts: number): Promise<{ id: string; type: "FILE" | "FOLDER"; size: bigint }[] | null> {
  const locked = new Set<string>();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rows = await tx.$queryRaw<{ id: string; type: "FILE" | "FOLDER"; size: bigint }[]>`
      WITH RECURSIVE sub AS (
        SELECT id, 0 AS depth FROM "Node" WHERE id = ANY(${[...topIds]})
        UNION ALL
        SELECT n.id, s.depth + 1 FROM "Node" n JOIN sub s ON n."parentId" = s.id
      )
      SELECT n.id, n.type::text AS type, n.size FROM "Node" n JOIN (SELECT id, depth FROM sub) d ON d.id = n.id
      ORDER BY d.depth, n.id
      FOR UPDATE OF n`;
    if (rows.length === locked.size && rows.every((row) => locked.has(row.id))) return rows;
    for (const row of rows) locked.add(row.id);
  }
  return null;
}

/**
 * Locks a node and its ancestors FOR SHARE inside a transaction and returns the chain from the
 * account root down (as {@link ancestorChain}), or null when the node is gone (or its chain kept
 * changing for `attempts`). Until the transaction ends nothing on the chain can be renamed, moved
 * or deleted, so a path built from it stays valid (an upload deduplicated against this file links
 * to it inside the transaction).
 */
export async function lockAncestorChain(tx: DbClient, nodeId: string, attempts: number): Promise<AncestorRow[] | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const chain = await ancestorChain(tx, nodeId);
    if (chain.length === 0) return null;
    const ids = chain.map((row) => row.id);
    // From the root down, like lockSubtrees, so a delete and this lock never wait on each other in a cycle.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Node" WHERE id = ANY(${ids}) ORDER BY array_position(${ids}::text[], id) FOR SHARE`;
    if (locked.length !== ids.length) continue;
    // Read again under the locks: a rename or move that committed before them changed the chain.
    const again = await ancestorChain(tx, nodeId);
    if (again.length === chain.length && again.every((row, index) => row.id === chain[index]!.id && row.name === chain[index]!.name)) return again;
  }
  return null;
}
