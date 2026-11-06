import "server-only";
import { ranOutWith } from "@/domain/share-limits";
import { Prisma, type DbClient, type PrismaClient } from "../db/client";
import { childStats } from "./node-tree.repo";
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
  /** The worker could not make the metadata-stripped copy. */
  stripFailed: boolean;
  hasThumb: boolean;
  downloads: number;
  downloadLimit: number | null;
  dlPaused: boolean;
  access: "BOTH" | "STREAM";
  /** Delete after the first download. */
  burn: boolean;
  createdAt: Date;
}

/** Columns of a SharedRow, read from "Node" n. */
const SHARED_COLUMNS = Prisma.sql`n.id, n."parentId", n.type::text AS type, n.name, n.kind::text AS kind, n.mime, n.size, n.sha256, n."hasDerived", n."stripFailed", n."hasThumb", n.downloads,
           n."downloadLimit", n."dlPaused", n.access::text AS access, n.burn, n."createdAt"`;

/**
 * What visitors of a link may see below it (on "Node" n): not private, without a password of its
 * own (reachable only through its own link, where the password is asked) and not expired (deleted
 * by the daily cleanup). Walks stop at anything else, so neither it nor its contents are listed,
 * sized or zipped (share.service `closedBelowLink` is the same rule for one chain).
 */
const openBelowLink = (now: Date) => Prisma.sql`n.visibility <> 'PRIVATE' AND n."passwordHash" IS NULL AND (n."expAt" IS NULL OR n."expAt" > ${now})`;

/** The walk of {@link publicTree}, as a WITH RECURSIVE clause named `tree` (the item itself first). */
const publicWalk = (rootId: string, now: Date) => Prisma.sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Node" WHERE id = ${rootId}
      UNION ALL
      SELECT n.id FROM "Node" n JOIN tree t ON n."parentId" = t.id
      WHERE ${openBelowLink(now)}
    )`;

/**
 * An item and everything below it that visitors may see ({@link openBelowLink}), at most `limit`
 * rows (the item included): "Download all" of a folder in a link.
 */
export async function publicTree(db: DbClient, rootId: string, now: Date, limit: number): Promise<SharedRow[]> {
  return db.$queryRaw<SharedRow[]>`
    ${publicWalk(rootId, now)}
    SELECT ${SHARED_COLUMNS}
    FROM (SELECT id FROM tree LIMIT ${limit}) t JOIN "Node" n ON n.id = t.id`;
}

/** How many rows {@link publicTree} would return, counting no further than `limit`. */
export async function publicTreeSize(db: DbClient, rootId: string, now: Date, limit: number): Promise<number> {
  const [row] = await db.$queryRaw<{ count: bigint }[]>`
    ${publicWalk(rootId, now)}
    SELECT COUNT(*)::bigint AS count FROM (SELECT id FROM tree LIMIT ${limit}) t`;
  return Number(row?.count ?? 0);
}

/** The items directly inside a folder of a link that visitors may see ({@link openBelowLink}). */
export function publicChildren(db: DbClient, folderId: string, now: Date): Promise<SharedRow[]> {
  return db.$queryRaw<SharedRow[]>`
    SELECT ${SHARED_COLUMNS} FROM "Node" n WHERE n."parentId" = ${folderId} AND ${openBelowLink(now)}`;
}

/**
 * Bytes and direct item counts of what visitors may see inside each item of a folder in a link
 * (one walk below the folder, see {@link childStats}).
 */
export function publicChildStats(db: DbClient, folderId: string, now: Date) {
  return childStats(db, folderId, openBelowLink(now));
}

/**
 * A node on the way from the account root down to a file, with its own link settings: every
 * one of them guards the file, whichever link it is reached through (share.service `guardsOf`).
 */
export type ChainRow = SharedRow & {
  visibility: "INHERIT" | "PRIVATE" | "PUBLIC";
  linkId: string;
  expAt: Date | null;
  passwordHash: string | null;
};

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
    SELECT ${SHARED_COLUMNS}, n.visibility::text AS visibility, n."linkId", n."expAt", n."passwordHash"
    FROM chain JOIN "Node" n ON n.id = chain.id
    ORDER BY chain.depth DESC`;
}

/** Thrown inside the claim transaction to roll back counts already made. */
class LimitReached extends Error {}

/** An item a counted download used up (its limit reached, or its one download before deletion). */
export interface UsedUpItem {
  id: string;
  name: string;
  type: "FILE" | "FOLDER";
  cause: "limit" | "burn";
  downloads: number;
}

interface ClaimedRow {
  id: string;
  name: string;
  type: "FILE" | "FOLDER";
  downloads: number;
  downloadLimit: number | null;
  burn: boolean;
}

const usedUp = (rows: readonly ClaimedRow[]): UsedUpItem[] =>
  rows.flatMap((row) => {
    const cause = ranOutWith(row);
    return cause ? [{ id: row.id, name: row.name, type: row.type, cause, downloads: row.downloads }] : [];
  });

/**
 * Counts a public download on every given item (the file, the link it was reached through and
 * each item between with its own limit or delete-after-download), only while every one of them
 * is under its download limit and no used delete-after-download item is among them. Each
 * UPDATE re-checks the limit on the locked row, so concurrent requests at N-1 cannot all pass.
 * Returns null (nothing counted) when a limit is reached, else the items this download used up.
 */
export async function claimDownload(db: PrismaClient, ids: readonly string[]): Promise<{ usedUp: UsedUpItem[] } | null> {
  try {
    const claimed = await db.$transaction(async (tx) => {
      const rows: ClaimedRow[] = [];
      for (const id of new Set(ids)) {
        const [row] = await tx.$queryRaw<ClaimedRow[]>`
          UPDATE "Node" SET downloads = downloads + 1
          WHERE id = ${id}
            AND ("downloadLimit" IS NULL OR "downloadLimit" <= 0 OR downloads < "downloadLimit")
            AND NOT (burn AND downloads >= 1)
          RETURNING id, name, type::text AS type, downloads, "downloadLimit", burn`;
        if (!row) throw new LimitReached();
        rows.push(row);
      }
      return rows;
    });
    return { usedUp: usedUp(claimed) };
  } catch (error) {
    if (error instanceof LimitReached) return null;
    throw error;
  }
}

/**
 * Counts one download on each item still under its limit (and not a used delete-after-download
 * item), in one statement (the files of a "Download all" zip). Returns the ids that were
 * counted (the rest are at their limit) and the items this used up.
 */
export async function claimEachDownload(db: DbClient, ids: readonly string[]): Promise<{ counted: Set<string>; usedUp: UsedUpItem[] }> {
  if (ids.length === 0) return { counted: new Set(), usedUp: [] };
  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE "Node" SET downloads = downloads + 1
    WHERE id = ANY(${[...new Set(ids)]}::text[])
      AND ("downloadLimit" IS NULL OR "downloadLimit" <= 0 OR downloads < "downloadLimit")
      AND NOT (burn AND downloads >= 1)
    RETURNING id, name, type::text AS type, downloads, "downloadLimit", burn`;
  return { counted: new Set(rows.map((row) => row.id)), usedUp: usedUp(rows) };
}
