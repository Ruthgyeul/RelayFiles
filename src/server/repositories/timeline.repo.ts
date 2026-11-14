import "server-only";
import type { TimelinePosition } from "@/domain/timeline";
import { Prisma, type DbClient } from "../db/client";

export interface TimelineRow {
  id: string;
  parentId: string;
  name: string;
  kind: "IMAGE" | "VIDEO";
  size: bigint;
  hasThumb: boolean;
  /** takenAt, else modifiedAt, else createdAt: what the timeline is ordered by. */
  sortAt: Date;
  dated: boolean;
}

/** The date an item is placed at (keep in step with the ORDER BY below). */
const SORT_AT = Prisma.sql`COALESCE(n."takenAt", n."modifiedAt", n."createdAt")`;

/**
 * One page of an account's photos and videos, newest first by the date they were taken (else
 * their file date), then by id; `after` is the last item of the previous page (keyset paging,
 * so a page costs the same however far down it is). Left out: files missing on the disk, rows a
 * replaced file stepped aside as (a "/" in the name), and visitor uploads not yet found clean.
 */
export function timelinePage(db: DbClient, accountId: string, after: TimelinePosition | null, limit: number): Promise<TimelineRow[]> {
  const below = after ? Prisma.sql`AND (${SORT_AT}, n.id) < (${new Date(after.at)}, ${after.id})` : Prisma.empty;
  return db.$queryRaw<TimelineRow[]>`
    SELECT n.id, n."parentId", n.name, n.kind::text AS kind, n.size, n."hasThumb", ${SORT_AT} AS "sortAt", n."takenAt" IS NOT NULL AS dated
    FROM "Node" n
    WHERE n."accountId" = ${accountId} AND n.type = 'FILE' AND n.kind IN ('IMAGE', 'VIDEO')
      AND NOT n.missing AND strpos(n.name, '/') = 0 AND n."scanState" NOT IN ('PENDING', 'FAILED')
      ${below}
    ORDER BY ${SORT_AT} DESC, n.id DESC
    LIMIT ${limit}`;
}
