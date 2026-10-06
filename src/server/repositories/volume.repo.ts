import "server-only";
import type { DbClient } from "../db/client";

export function listActiveVolumes(db: DbClient) {
  return db.storageVolume.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, driver: true, mountPath: true, status: true, reservePct: true },
  });
}

export function findVolume(db: DbClient, volumeId: string) {
  return db.storageVolume.findUnique({ where: { id: volumeId }, select: { id: true, driver: true, mountPath: true, status: true, reservePct: true } });
}
