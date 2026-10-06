import "server-only";
import { db } from "../db/client";
import { listActiveVolumes } from "../repositories/volume.repo";
import { driverFor } from "../storage/registry";

/** Used and total bytes over every active storage volume; null when none is mounted. */
export async function storageCapacity(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  const volumes = await listActiveVolumes(db());
  let total = 0n;
  let available = 0n;
  for (const volume of volumes) {
    const space = await driverFor(volume).space().catch(() => null);
    if (!space) continue;
    total += space.total;
    available += space.available;
  }
  return total > 0n ? { usedBytes: Number(total - available), totalBytes: Number(total) } : null;
}

/** True when every active volume accepts writes in its upload staging area. */
export async function storageWritable(): Promise<boolean> {
  const volumes = await listActiveVolumes(db());
  if (volumes.length === 0) return false;
  const results = await Promise.all(volumes.map((volume) => driverFor(volume).canWrite()));
  return results.every(Boolean);
}
