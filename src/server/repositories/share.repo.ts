import "server-only";
import type { DbClient } from "../db/client";
import { NODE_SELECT } from "./node.repo";

export function findByLinkId(db: DbClient, linkId: string) {
  return db.node.findUnique({ where: { linkId }, select: NODE_SELECT });
}

export interface SharedRow {
  id: string;
  parentId: string | null;
  type: "FILE" | "FOLDER";
  name: string;
  kind: "VIDEO" | "AUDIO" | "IMAGE" | "OTHER" | null;
  mime: string | null;
  size: bigint;
  sha256: string | null;
  hasDerived: boolean;
  hasThumb: boolean;
  downloads: number;
  downloadLimit: number | null;
  dlPaused: boolean;
  access: "BOTH" | "STREAM";
  createdAt: Date;
}

/**
 * The shared item and everything below it that visitors may see: the walk stops at items
 * set to private, so neither they nor their contents are listed, sized or zipped.
 */
export async function publicTree(db: DbClient, rootId: string): Promise<SharedRow[]> {
  return db.$queryRaw<SharedRow[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Node" WHERE id = ${rootId}
      UNION ALL
      SELECT n.id FROM "Node" n JOIN tree t ON n."parentId" = t.id WHERE n.visibility <> 'PRIVATE'
    )
    SELECT n.id, n."parentId", n.type::text AS type, n.name, n.kind::text AS kind, n.mime, n.size, n.sha256, n."hasDerived", n."hasThumb", n.downloads,
           n."downloadLimit", n."dlPaused", n.access::text AS access, n."createdAt"
    FROM tree JOIN "Node" n ON n.id = tree.id`;
}

/** Counts a public download on the item and on the link it was reached through. */
export async function countDownload(db: DbClient, ids: readonly string[]): Promise<void> {
  await db.node.updateMany({ where: { id: { in: [...new Set(ids)] } }, data: { downloads: { increment: 1 } } });
}
