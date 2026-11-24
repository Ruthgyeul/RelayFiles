import "server-only";
import { MEDIA } from "@/config/policy";
import type { DbClient } from "../db/client";

// Batches the media and data backfills walk: files in id order, after a keyset cursor (`afterId`).

/** Images and videos still without a thumbnail, in id order (a keyset cursor), for the backfill script. */
export function mediaWithoutThumbs(db: DbClient, take: number, afterId: string | null) {
  return db.node.findMany({
    where: { type: "FILE", kind: { in: [...MEDIA.processedKinds] }, hasThumb: false, missing: false, ...(afterId ? { id: { gt: afterId } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take,
  });
}

/** Images large enough for a viewer preview, in id order (a keyset cursor), for `media:backfill -- --previews`. */
export function imagesForPreview(db: DbClient, take: number, afterId: string | null) {
  return db.node.findMany({
    where: { type: "FILE", kind: "IMAGE", missing: false, size: { gte: MEDIA.previewMinBytes }, mime: { in: [...MEDIA.previewTypes] }, ...(afterId ? { id: { gt: afterId } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take,
  });
}

/**
 * Photos and videos whose shared copy does not match `mode` (SHARE_METADATA_STRIP): none made
 * yet, one made in another mode, or one from before modes. "npm run media:backfill -- --derived".
 */
export function mediaWithStaleCopies(db: DbClient, mode: "SENSITIVE" | "ALL", take: number, afterId: string | null) {
  return db.node.findMany({
    where: { type: "FILE", kind: { in: [...MEDIA.processedKinds] }, missing: false, stripFailed: false, OR: [{ derivedMode: null }, { derivedMode: { not: mode } }], ...(afterId ? { id: { gt: afterId } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take,
  });
}

/** Files without a modification time, by id, for the backfill data migration. */
export function filesWithoutModifiedAt(db: DbClient, take: number, afterId: string | null) {
  return db.node.findMany({
    where: { type: "FILE", modifiedAt: null, ...(afterId ? { id: { gt: afterId } } : {}) },
    select: { id: true, accountId: true, createdAt: true, missing: true, account: { select: { volumeId: true } } },
    orderBy: { id: "asc" },
    take,
  });
}

/** Files without a content hash, by id, for the backfill data migration. */
export function filesWithoutSha256(db: DbClient, take: number, afterId: string | null) {
  return db.node.findMany({
    where: { type: "FILE", sha256: null, ...(afterId ? { id: { gt: afterId } } : {}) },
    select: { id: true, accountId: true, size: true, missing: true, account: { select: { volumeId: true } } },
    orderBy: { id: "asc" },
    take,
  });
}

/** Photos and videos whose date taken was never read, by id (the release data migration queues them). */
export function mediaWithoutDateTaken(db: DbClient, take: number, afterId: string | null) {
  return db.node.findMany({
    where: { type: "FILE", kind: { in: [...MEDIA.processedKinds] }, takenAt: null, missing: false, ...(afterId ? { id: { gt: afterId } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take,
  });
}

/** Records a value a backfill computed. */
export async function setFileFacts(db: DbClient, nodeId: string, data: { modifiedAt?: Date; sha256?: string; takenAt?: Date }): Promise<void> {
  await db.node.update({ where: { id: nodeId }, data });
}

/** Records the modification time of many files in one statement (a backfill batch). */
export async function setModifiedTimes(db: DbClient, times: readonly { id: string; modifiedAt: Date }[]): Promise<void> {
  if (times.length === 0) return;
  const ids = times.map((time) => time.id);
  // Prisma keeps DateTime as UTC in a timestamp without time zone.
  const ats = times.map((time) => time.modifiedAt.toISOString());
  await db.$executeRaw`
    UPDATE "Node" AS n SET "modifiedAt" = v.at::timestamptz AT TIME ZONE 'UTC'
    FROM unnest(${ids}::text[], ${ats}::text[]) AS v(id, at)
    WHERE n.id = v.id`;
}
