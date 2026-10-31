import "server-only";
import type { DbClient, Prisma } from "../db/client";

/** Newest link events of nodes (a folder's log includes everything inside it). */
export function listLinkEvents(db: DbClient, nodeIds: string[], limit: number) {
  return db.linkEvent.findMany({ where: { nodeId: { in: nodeIds } }, orderBy: { at: "desc" }, take: limit, select: { kind: true, fileName: true, device: true, ipMasked: true, country: true, at: true } });
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
