import "server-only";
import { MS, STORAGE } from "@/config/policy";
import { setAccountMigrating, storageBusyOf, switchAccountVolume } from "../repositories/account.repo";
import { ApiError } from "../http/api-error";
import { db, type DbClient } from "../db/client";
import { isLockTimeout } from "../db/errors";
import type { VolumeStatus } from "../db/generated/client";
import { logger } from "../logger";
import { lockAccountWritesExclusive, lockVolumeWritesExclusive, lockWritesShared, writeStateOf } from "../repositories/advisory-lock.repo";
import { endVolumeHold, findVolume, holdVolumeReadOnly, listActiveVolumes } from "../repositories/volume.repo";
import type { StorageDriver } from "../storage/driver";
import { availableAboveReserve, driverFor, pickVolumeForNewAccount, type VolumeCandidate } from "../storage/registry";
import { checkVolume } from "../storage/volume";

/**
 * Chooses the volume for a new account: the mounted ACTIVE volume with the most free space
 * above its reserve (docs/architecture.md "스토리지"). Unmounted volumes are skipped so a
 * missing SSD never receives writes on the system disk.
 */
export async function volumeForNewAccount(): Promise<StorageDriver> {
  const volumes = await listActiveVolumes(db());
  if (volumes.length === 0) throw new ApiError("STORAGE_OFFLINE", "No storage volume is registered. Run npm run volume:init on the server.");
  const candidates: VolumeCandidate[] = [];
  for (const volume of volumes) {
    const state = await checkVolume(volume.mountPath, volume.id);
    if (state.state !== "online") {
      logger.warn("volume unavailable for new accounts", { volumeId: volume.id, state: state.state });
      continue;
    }
    const space = await driverFor(volume).space();
    candidates.push({ id: volume.id, status: volume.status, available: availableAboveReserve(space.total, space.available, volume.reservePct) });
  }
  const chosen = pickVolumeForNewAccount(candidates);
  if (!chosen) {
    throw candidates.length === 0 ? new ApiError("STORAGE_OFFLINE") : new ApiError("INSUFFICIENT_STORAGE");
  }
  const volume = volumes.find((item) => item.id === chosen)!;
  return driverFor(volume);
}

/**
 * Refuses changes while an account's files are being moved to another volume, or while its
 * volume is read-only for a layout migration (docs/runbook.md). Reads keep working.
 */
export async function assertAccountWritable(accountId: string): Promise<void> {
  const busy = await storageBusyOf(db(), accountId);
  if (busy === null) throw new ApiError("NOT_FOUND");
  if (busy) throw new ApiError("STORAGE_BUSY");
}

/**
 * The first step of every storage transaction that changes an account's files (docs/architecture.md
 * "쓰기 잠금"). Takes the shared write locks of the volume and the account, then checks again what
 * `driverForAccount(…, "write")` checked when the operation started: the work before the
 * transaction (copying, hashing an upload) can take long, and a volume move or a layout migration
 * may have started or even finished meanwhile. `volumeId` is the volume the operation writes to
 * (`driver.volumeId`); an account that moved off it gets STORAGE_BUSY, so nothing lands on the old
 * volume after the switch. The locks are held until the transaction ends, which is what a move
 * or a migration waits for before it starts.
 */
export async function lockAccountForWrite(tx: DbClient, accountId: string, volumeId: string): Promise<void> {
  await lockWritesShared(tx, accountId, volumeId);
  const state = await writeStateOf(tx, accountId);
  if (!state) throw new ApiError("NOT_FOUND");
  if (state.volumeStatus === "OFFLINE") throw new ApiError("STORAGE_OFFLINE");
  if (state.migrating || state.volumeStatus === "READONLY" || state.volumeId !== volumeId) throw new ApiError("STORAGE_BUSY");
}

/** Runs `step` in a transaction that may wait STORAGE.writeDrainTimeoutSec for running writes to end. */
async function afterRunningWrites(what: string, step: (tx: DbClient) => Promise<void>): Promise<void> {
  try {
    await db().$transaction(step, { timeout: (STORAGE.writeDrainTimeoutSec + STORAGE.transactionTimeoutSec) * MS.second });
  } catch (error) {
    if (isLockTimeout(error)) throw new Error(`Changes to ${what} were still running after ${STORAGE.writeDrainTimeoutSec} s, so nothing was changed. Try again.`);
    throw error;
  }
}

/** Starts a volume move: waits for the account's running writes, then refuses new ones (migrating). */
export async function startAccountMove(accountId: string): Promise<void> {
  await afterRunningWrites(`account ${accountId}`, async (tx) => {
    await lockAccountWritesExclusive(tx, accountId, STORAGE.writeDrainTimeoutSec);
    await setAccountMigrating(tx, accountId, true);
  });
}

/** Ends a volume move: the account lives on `volumeId` from now on and takes changes again. */
export async function finishAccountMove(accountId: string, volumeId: string): Promise<void> {
  await afterRunningWrites(`account ${accountId}`, async (tx) => {
    await lockAccountWritesExclusive(tx, accountId, STORAGE.writeDrainTimeoutSec);
    await switchAccountVolume(tx, accountId, volumeId);
  });
}

/**
 * Makes a volume READONLY for maintenance (a layout migration, `storage:fsck --fix`) once the
 * writes running on it have ended; later ones are refused with STORAGE_BUSY. `resumeStatus` is
 * what {@link endMaintenanceHold} restores; it is stored, so an interrupted run still knows it.
 */
export async function startMaintenanceHold(volumeId: string, resumeStatus: VolumeStatus): Promise<void> {
  await afterRunningWrites(`volume ${volumeId}`, async (tx) => {
    await lockVolumeWritesExclusive(tx, volumeId, STORAGE.writeDrainTimeoutSec);
    await holdVolumeReadOnly(tx, volumeId, resumeStatus);
  });
}

/** Ends a maintenance hold: the volume returns to the status it had before it. */
export async function endMaintenanceHold(volumeId: string, status: VolumeStatus): Promise<void> {
  await endVolumeHold(db(), volumeId, status);
}

/** Storage driver of the volume an account lives on; `write` also checks that changes are allowed. */
export async function driverForAccount(account: { id: string; volumeId: string }, mode: "read" | "write" = "read"): Promise<StorageDriver> {
  if (mode === "write") await assertAccountWritable(account.id);
  const volume = await findVolume(db(), account.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  return driverFor(volume);
}
