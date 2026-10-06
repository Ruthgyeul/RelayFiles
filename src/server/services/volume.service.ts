import "server-only";
import { ApiError } from "../http/api-error";
import { db } from "../db/client";
import { logger } from "../logger";
import { findVolume, listActiveVolumes } from "../repositories/volume.repo";
import type { StorageDriver } from "../storage/driver";
import { availableAboveReserve, driverFor, pickVolumeForNewAccount, type VolumeCandidate } from "../storage/registry";
import { checkVolume } from "../storage/volume";

/**
 * Chooses the volume for a new account: the mounted ACTIVE volume with the most free space
 * above its reserve (docs/plan.md §13.5 "다중 볼륨"). Unmounted volumes are skipped so a
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

/** Storage driver of the volume an account lives on. */
export async function driverForAccount(account: { volumeId: string }): Promise<StorageDriver> {
  const volume = await findVolume(db(), account.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  return driverFor(volume);
}
