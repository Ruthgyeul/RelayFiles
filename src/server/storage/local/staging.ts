import "server-only";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { DIR_MODE, type VolumeLayout } from "../layout";
import { StorageEntryMissingError, type CopyEntry, type StorageLocation } from "../driver";
import { resolveInsideUserRoot } from "../safe-path";
import { copyFileEntry, dedupe } from "./copy";
import { errorCode, NO_HARD_LINK } from "./fs-errors";
import { pathOf } from "./locations";

// Bytes prepared in the volume's upload area (system/tmp/uploads) and put into place in one rename.

/** Name of the copied item inside its staging folder (`system/tmp/uploads/copy-<id>/item`). */
const STAGED_ITEM = "item";

export async function moveIntoPlace(layout: VolumeLayout, tempPath: string, location: StorageLocation): Promise<void> {
  if (!tempPath.startsWith(layout.uploads)) throw new Error("Uploads must come from the volume's upload area.");
  // The folder must still exist: creating it again here would bring back a folder renamed or
  // deleted while the upload finished, outside the database.
  await rename(tempPath, await pathOf(layout, location));
}

export async function linkExisting(layout: VolumeLayout, from: StorageLocation, to: StorageLocation, size: number): Promise<boolean> {
  if (!dedupe()) return false;
  try {
    const source = await pathOf(layout, from);
    const info = await lstat(source);
    if (!info.isFile() || info.size !== size) return false;
    await link(source, await pathOf(layout, to));
    return true;
  } catch (error) {
    // Gone meanwhile, or no hard links here: the caller places its own bytes.
    if (errorCode(error) === "ENOENT" || NO_HARD_LINK.has(errorCode(error))) return false;
    throw error;
  }
}

export async function stageCopy(layout: VolumeLayout, from: StorageLocation, entries: readonly CopyEntry[]): Promise<string> {
  // The item's own path is checked like any other (inside the account root, no links).
  await pathOf(layout, from);
  await mkdir(layout.uploads, { recursive: true, mode: DIR_MODE });
  // Its own new folder: the cleanup reads the folder's time, not the time of hard-linked files,
  // which keep the original's (an old file copied just now must not look abandoned).
  const dir = join(layout.uploads, `copy-${randomUUID()}`);
  await mkdir(dir, { mode: DIR_MODE });
  const target = join(dir, STAGED_ITEM);
  try {
    // Parents come before children, so every folder on a file's path was checked to be a real folder.
    for (const entry of entries) {
      const source = resolveInsideUserRoot(layout.root, from.accountId, [...from.segments, ...entry.segments]);
      const info = await lstat(source).catch((error: unknown) => {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      });
      if (!info || (entry.type === "folder" ? !info.isDirectory() : !info.isFile())) throw new StorageEntryMissingError();
      const copy = join(target, ...entry.segments);
      if (entry.type === "folder") await mkdir(copy, { mode: DIR_MODE });
      else await copyFileEntry(source, copy);
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return target;
}

export async function discardStaged(layout: VolumeLayout, tempPath: string): Promise<void> {
  if (!tempPath.startsWith(layout.uploads + sep)) throw new Error("Only the volume's upload area holds staged files.");
  // A staged copy sits in its own folder (copy-<id>/item): that folder goes with it.
  const parent = dirname(tempPath);
  const own = parent !== layout.uploads && dirname(parent) === layout.uploads;
  await rm(own ? parent : tempPath, { recursive: true, force: true });
}
