import "server-only";
import type { DbClient } from "../db/client";

export function listActiveVolumes(db: DbClient) {
  return db.storageVolume.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, driver: true, mountPath: true, status: true, reservePct: true },
  });
}

/**
 * Volumes the daily job empties the trash and stale uploads of: ACTIVE ones and DRAINING ones,
 * whose trash holds the originals of accounts moved away until it is purged.
 */
export function listPurgeableVolumes(db: DbClient) {
  return db.storageVolume.findMany({
    where: { status: { in: ["ACTIVE", "DRAINING"] } },
    select: { id: true, driver: true, mountPath: true, status: true, reservePct: true },
  });
}

export function findVolume(db: DbClient, volumeId: string) {
  return db.storageVolume.findUnique({ where: { id: volumeId }, select: { id: true, driver: true, mountPath: true, status: true, reservePct: true } });
}
