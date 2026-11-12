import "server-only";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { StorageLocation, VersionRef } from "../driver";
import { DIR_MODE, type VolumeLayout } from "../layout";
import { assetPath } from "./assets";
import { pathOf, renameNoReplacePath } from "./locations";

// Earlier versions of replaced files: system/versions/<accountId>/<versionId> on the same volume,
// so moving one in or out is a rename (the inode, and a hard link to it, stay as they are).

const versionPath = (layout: VolumeLayout, { accountId, versionId }: VersionRef) => assetPath(layout, "version", accountId, versionId);

/** Moves the file at `location` aside as an earlier version. */
export async function moveToVersion(layout: VolumeLayout, location: StorageLocation, ref: VersionRef): Promise<void> {
  const target = versionPath(layout, ref);
  await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
  await rename(await pathOf(layout, location), target);
}

/** Puts an earlier version back at `location`; refuses (StorageTargetExistsError) when something is there. */
export async function restoreVersion(layout: VolumeLayout, ref: VersionRef, location: StorageLocation): Promise<void> {
  await renameNoReplacePath(versionPath(layout, ref), await pathOf(layout, location));
}

/** Removes an earlier version for good (a missing one is fine). */
export async function removeVersion(layout: VolumeLayout, ref: VersionRef): Promise<void> {
  await rm(versionPath(layout, ref), { force: true });
}
