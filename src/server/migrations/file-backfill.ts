import "server-only";
import { segmentsBelowRoot } from "@/domain/tree";
import type { DbClient } from "../db/client";
import { ancestorChains } from "../repositories/node-tree.repo";
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
    /** Where each file of a batch is on its volume, from one walk up the tree for the batch. */
    async locationsOf(rows: readonly { id: string; accountId: string }[]): Promise<Map<string, StorageLocation>> {
      const chains = await ancestorChains(
        db,
        rows.map((row) => row.id),
      );
      return new Map(rows.flatMap((row) => {
        const chain = chains.get(row.id);
        return chain ? [[row.id, { accountId: row.accountId, segments: segmentsBelowRoot(chain) }] as const] : [];
      }));
    },
  };
}
