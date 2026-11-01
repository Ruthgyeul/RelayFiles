import "server-only";
import type { DbClient } from "../db/client";
// The enum, not the storage/driver.ts interface of the same name.
import type { StorageDriver as DriverKind, VolumeStatus } from "../db/generated/client";

const VOLUME_SELECT = { id: true, driver: true, mountPath: true, status: true, reservePct: true, resumeStatus: true } as const;

export function listActiveVolumes(db: DbClient) {
  return db.storageVolume.findMany({
    where: { status: "ACTIVE" },
    select: VOLUME_SELECT,
  });
}

/**
 * Volumes the daily job empties the trash and stale uploads of: ACTIVE ones and DRAINING ones,
 * whose trash holds the originals of accounts moved away until it is purged.
 */
export function listPurgeableVolumes(db: DbClient) {
  return db.storageVolume.findMany({
    where: { status: { in: ["ACTIVE", "DRAINING"] } },
    select: VOLUME_SELECT,
  });
}

export function findVolume(db: DbClient, volumeId: string) {
  return db.storageVolume.findUnique({ where: { id: volumeId }, select: VOLUME_SELECT });
}

/** Volumes in any of `statuses`, optionally of one driver. */
export function listVolumesIn(db: DbClient, statuses: readonly VolumeStatus[], driver?: DriverKind) {
  return db.storageVolume.findMany({ where: { status: { in: [...statuses] }, ...(driver ? { driver } : {}) }, select: VOLUME_SELECT });
}

/** Every registered volume, oldest first, with how many accounts it holds (npm run volume:list). */
export function listVolumesWithAccounts(db: DbClient) {
  return db.storageVolume.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { accounts: true } } } });
}

export function findVolumeWithAccounts(db: DbClient, volumeId: string) {
  return db.storageVolume.findUnique({ where: { id: volumeId }, include: { _count: { select: { accounts: true } } } });
}

export async function setVolumeStatus(db: DbClient, volumeId: string, status: VolumeStatus): Promise<void> {
  await db.storageVolume.update({ where: { id: volumeId }, data: { status } });
}

/**
 * Sets the status only while it is still `expected` (nobody changed it meanwhile, e.g. a
 * migration that set READONLY). Returns whether it changed.
 */
export async function switchVolumeStatus(db: DbClient, volumeId: string, expected: VolumeStatus, status: VolumeStatus): Promise<boolean> {
  const { count } = await db.storageVolume.updateMany({ where: { id: volumeId, status: expected }, data: { status } });
  return count > 0;
}

/** Records a finished layout migration and the status the volume returns to (ending its hold). */
export async function setVolumeLayout(db: DbClient, volumeId: string, layoutVersion: number, status: VolumeStatus): Promise<void> {
  await db.storageVolume.update({ where: { id: volumeId }, data: { status, layoutVersion, resumeStatus: null } });
}

/** Makes a volume READONLY for maintenance and remembers the status it returns to afterwards. */
export async function holdVolumeReadOnly(db: DbClient, volumeId: string, resumeStatus: VolumeStatus): Promise<void> {
  await db.storageVolume.update({ where: { id: volumeId }, data: { status: "READONLY", resumeStatus } });
}

/** Ends a maintenance hold: the volume returns to the status it had before. */
export async function endVolumeHold(db: DbClient, volumeId: string, status: VolumeStatus): Promise<void> {
  await db.storageVolume.update({ where: { id: volumeId }, data: { status, resumeStatus: null } });
}

/**
 * Registers a volume, or updates the mount path of a known one (npm run volume:init). A remount
 * brings an OFFLINE volume back; READONLY and DRAINING belong to a running migration and stay.
 */
export async function registerVolume(db: DbClient, volume: { id: string; mountPath: string; layoutVersion: number; reservePct: number }): Promise<void> {
  const existing = await db.storageVolume.findUnique({ where: { id: volume.id }, select: { status: true } });
  await db.storageVolume.upsert({
    where: { id: volume.id },
    create: volume,
    update: { mountPath: volume.mountPath, ...(existing?.status === "OFFLINE" ? { status: "ACTIVE" as const } : {}) },
  });
}

export async function deleteVolume(db: DbClient, volumeId: string): Promise<void> {
  await db.storageVolume.delete({ where: { id: volumeId } });
}
