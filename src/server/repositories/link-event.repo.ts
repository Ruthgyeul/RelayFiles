import "server-only";
import type { DbClient, Prisma } from "../db/client";

// The ids go in as one array parameter (= ANY): Prisma cannot split an IN list it groups or
// sorts, and PostgreSQL refuses more than 65,535 parameters (an account holds up to 100,000 items).

/** When each item's share link was last used (items without events are absent). */
export async function lastLinkEventAt(db: DbClient, nodeIds: readonly string[]): Promise<Map<string, Date>> {
  if (nodeIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ nodeId: string; at: Date }[]>`
    SELECT "nodeId", MAX(at) AS at FROM "LinkEvent" WHERE "nodeId" = ANY(${[...nodeIds]}) GROUP BY "nodeId"`;
  return new Map(rows.map((row) => [row.nodeId, row.at] as const));
}

export interface LinkEventRow {
  kind: Prisma.LinkEventGetPayload<object>["kind"];
  fileName: string;
  device: string;
  ipMasked: string;
  country: string;
  at: Date;
}

/**
 * Newest link events of an item; a folder's log includes everything inside it (walked in the same
 * query, so a folder of any size is one statement).
 */
export function listLinkEventsBelow(db: DbClient, nodeId: string, limit: number): Promise<LinkEventRow[]> {
  return db.$queryRaw<LinkEventRow[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Node" WHERE id = ${nodeId}
      UNION ALL
      SELECT n.id FROM "Node" n JOIN sub s ON n."parentId" = s.id
    )
    SELECT e.kind::text AS kind, e."fileName", e.device, e."ipMasked", e.country, e.at
    FROM "LinkEvent" e JOIN sub ON e."nodeId" = sub.id
    ORDER BY e.at DESC, e.id DESC
    LIMIT ${limit}`;
}

export async function addLinkEvent(db: DbClient, data: Prisma.LinkEventUncheckedCreateInput): Promise<void> {
  await db.linkEvent.create({ data });
}

/** Keeps the newest `keep` events of a node. */
export async function trimLinkEvents(db: DbClient, nodeId: string, keep: number): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "LinkEvent" WHERE "nodeId" = ${nodeId} AND id NOT IN (
      SELECT id FROM "LinkEvent" WHERE "nodeId" = ${nodeId} ORDER BY at DESC, id DESC LIMIT ${keep}
    )`;
}

/** Hands a node's link history to the node that replaced it (same share link, new content). */
export async function moveLinkEvents(db: DbClient, fromNodeId: string, toNodeId: string): Promise<void> {
  await db.linkEvent.updateMany({ where: { nodeId: fromNodeId }, data: { nodeId: toNodeId } });
}
