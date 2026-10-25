import "server-only";
import type { DbClient, PrismaClient } from "../db/client";
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

/** A node on the way from the account root down to a file, with what visibility it was set to. */
export type ChainRow = SharedRow & { visibility: "INHERIT" | "PRIVATE" | "PUBLIC" };

/**
 * One node and every folder above it, from the account root down (O(depth), one query):
 * what a single shared file needs to be checked and located, instead of the link's whole tree.
 */
export async function sharedChain(db: DbClient, nodeId: string): Promise<ChainRow[]> {
  return db.$queryRaw<ChainRow[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId", 0 AS depth FROM "Node" WHERE id = ${nodeId}
      UNION ALL
      SELECT n.id, n."parentId", c.depth + 1 FROM "Node" n JOIN chain c ON n.id = c."parentId"
    )
    SELECT n.id, n."parentId", n.type::text AS type, n.name, n.kind::text AS kind, n.mime, n.size, n.sha256, n."hasDerived", n."hasThumb", n.downloads,
           n."downloadLimit", n."dlPaused", n.access::text AS access, n."createdAt", n.visibility::text AS visibility
    FROM chain JOIN "Node" n ON n.id = chain.id
    ORDER BY chain.depth DESC`;
}

export interface DownloadClaim {
  id: string;
  /** Also refuse once downloaded when the item is a delete-after-download link (the link it was reached through). */
  burn: boolean;
}

/** Thrown inside the claim transaction to roll back counts already made. */
class LimitReached extends Error {}

/**
 * Counts a public download on the item and on the link it was reached through, only while
 * every one of them is under its download limit (and a used delete-after-download link stays
 * used). Each UPDATE re-checks the limit on the locked row, so concurrent requests at N-1
 * cannot all pass. Returns false (nothing counted) when a limit is reached.
 */
export async function claimDownload(db: PrismaClient, claims: readonly DownloadClaim[]): Promise<boolean> {
  const unique = new Map<string, boolean>();
  for (const claim of claims) unique.set(claim.id, (unique.get(claim.id) ?? false) || claim.burn);
  try {
    await db.$transaction(async (tx) => {
      for (const [id, burn] of unique) {
        const counted = await tx.$executeRaw`
          UPDATE "Node" SET downloads = downloads + 1
          WHERE id = ${id}
            AND ("downloadLimit" IS NULL OR "downloadLimit" <= 0 OR downloads < "downloadLimit")
            AND NOT (${burn} AND burn AND downloads >= 1)`;
        if (counted === 0) throw new LimitReached();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof LimitReached) return false;
    throw error;
  }
}

/**
 * Counts one download on each item still under its limit, in one statement (the files of a
 * "Download all" zip). Returns the ids that were counted; the rest are at their limit.
 */
export async function claimEachDownload(db: DbClient, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Node" SET downloads = downloads + 1
    WHERE id = ANY(${[...new Set(ids)]}::text[])
      AND ("downloadLimit" IS NULL OR "downloadLimit" <= 0 OR downloads < "downloadLimit")
    RETURNING id`;
  return new Set(rows.map((row) => row.id));
}
