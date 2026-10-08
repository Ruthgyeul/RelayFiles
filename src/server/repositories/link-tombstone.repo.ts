import "server-only";
import type { DbClient } from "../db/client";

/**
 * Records the share links of items about to be deleted because they expired: the items
 * themselves and everything inside them (their links stop working too).
 */
export async function retireLinks(db: DbClient, nodeIds: readonly string[], at: Date): Promise<void> {
  if (nodeIds.length === 0) return;
  await db.$executeRaw`
    WITH RECURSIVE tree AS (
      SELECT id, "linkId" FROM "Node" WHERE id = ANY(${[...nodeIds]}::text[])
      UNION ALL
      SELECT n.id, n."linkId" FROM "Node" n JOIN tree t ON n."parentId" = t.id
    )
    INSERT INTO "LinkTombstone" ("linkId", "endedAt")
    SELECT "linkId", ${at} FROM tree
    ON CONFLICT ("linkId") DO NOTHING`;
}

/** Whether a link that no longer exists ended because its items expired. */
export async function isRetiredLink(db: DbClient, linkId: string): Promise<boolean> {
  return (await db.linkTombstone.count({ where: { linkId } })) > 0;
}

/** Forgets links that ended before `before`; returns how many. */
export async function purgeRetiredLinks(db: DbClient, before: Date): Promise<number> {
  return (await db.linkTombstone.deleteMany({ where: { endedAt: { lt: before } } })).count;
}
