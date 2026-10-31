import "server-only";
import { segmentsBelowRoot } from "@/domain/tree";
import type { DbClient } from "../db/client";
import { ancestorChain } from "../repositories/node-tree.repo";
import { findVolume } from "../repositories/volume.repo";
import type { StorageDriver, StorageLocation } from "../storage/driver";
import { driverFor } from "../storage/registry";

/**
 * Storage access for backfills that read files: one driver per volume, none for an OFFLINE or
 * unknown volume (its files are left as they are and logged, so a release never stops on them).
 */
export function fileReader(db: DbClient) {
  const drivers = new Map<string, StorageDriver | null>();
  return {
    async driverOf(volumeId: string): Promise<StorageDriver | null> {
      if (!drivers.has(volumeId)) {
        const volume = await findVolume(db, volumeId);
        drivers.set(volumeId, volume && volume.status !== "OFFLINE" ? driverFor(volume) : null);
      }
      return drivers.get(volumeId)!;
    },
    async locationOf(accountId: string, nodeId: string): Promise<StorageLocation> {
      return { accountId, segments: segmentsBelowRoot(await ancestorChain(db, nodeId)) };
    },
  };
}
