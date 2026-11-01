import "server-only";
import { constants } from "node:fs";
import { link, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import type { Readable } from "node:stream";
import { DIR_MODE, type VolumeLayout } from "../layout";
import { StorageTargetExistsError, type StorageLocation, type StorageStat } from "../driver";
import { assertNoSymlinks, resolveInsideUserRoot, userRootOf } from "../safe-path";
import { copyEntry } from "./copy";
import { errorCode, NO_HARD_LINK, pathExists } from "./fs-errors";

// Items in an account's folder tree (users/<accountId>/…), addressed by StorageLocation.

/** Resolves and checks a location: inside the account root and free of symbolic links. */
export async function pathOf(layout: VolumeLayout, { accountId, segments }: StorageLocation): Promise<string> {
  const target = resolveInsideUserRoot(layout.root, accountId, segments);
  await assertNoSymlinks(userRootOf(layout.root, accountId), target);
  return target;
}

export async function ensureUserRoot(layout: VolumeLayout, accountId: string): Promise<void> {
  await mkdir(userRootOf(layout.root, accountId), { recursive: true, mode: DIR_MODE });
}

export async function statLocation(layout: VolumeLayout, location: StorageLocation): Promise<StorageStat | null> {
  try {
    const info = await stat(await pathOf(layout, location), { bigint: true });
    return { type: info.isDirectory() ? "folder" : "file", size: info.size, modifiedAt: info.mtime };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readStream(layout: VolumeLayout, location: StorageLocation, range?: { start: number; end: number }): Promise<Readable> {
  // O_NOFOLLOW: refuse to open the final component if it was swapped for a symlink.
  const handle = await open(await pathOf(layout, location), constants.O_RDONLY | constants.O_NOFOLLOW);
  return handle.createReadStream({ ...range, autoClose: true });
}

export async function createFolder(layout: VolumeLayout, location: StorageLocation): Promise<void> {
  await mkdir(await pathOf(layout, location), { mode: DIR_MODE });
}

export async function renameLocation(layout: VolumeLayout, from: StorageLocation, to: StorageLocation): Promise<void> {
  const [source, target] = await Promise.all([pathOf(layout, from), pathOf(layout, to)]);
  await rename(source, target);
}

export async function renameNoReplace(layout: VolumeLayout, from: StorageLocation, to: StorageLocation): Promise<void> {
  const [source, target] = await Promise.all([pathOf(layout, from), pathOf(layout, to)]);
  try {
    // link() fails with EEXIST instead of replacing: the check and the rename are one step.
    await link(source, target);
  } catch (error) {
    if (errorCode(error) === "EEXIST") throw new StorageTargetExistsError();
    if (!NO_HARD_LINK.has(errorCode(error))) throw error;
    // No hard links here (or the link count is at its limit): check, then rename.
    if (await pathExists(target)) throw new StorageTargetExistsError();
    await rename(source, target);
    return;
  }
  await unlink(source);
}

export async function copyLocation(layout: VolumeLayout, from: StorageLocation, to: StorageLocation): Promise<void> {
  const [source, target] = await Promise.all([pathOf(layout, from), pathOf(layout, to)]);
  await copyEntry(source, target);
}
