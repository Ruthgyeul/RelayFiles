import "server-only";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, lstat, mkdir, rm, stat } from "node:fs/promises";
import { Readable, type Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { DIR_MODE, FILE_MODE, inUploadArea, type VolumeLayout } from "../layout";
import { StorageEntryMissingError, type CopyEntry, type StorageLocation } from "../driver";
import { resolveInsideUserRoot } from "../safe-path";
import { copyFileEntry, dedupe } from "./copy";
import { errorCode, NO_HARD_LINK } from "./fs-errors";
import { pathOf, renameNoReplacePath } from "./locations";

// Bytes prepared in the volume's upload area (system/tmp/uploads) and put into place in one rename.

/** Name of the copied item inside its staging folder (`system/tmp/uploads/copy-<id>/item`). */
const STAGED_ITEM = "item";

export async function moveIntoPlace(layout: VolumeLayout, tempPath: string, location: StorageLocation): Promise<void> {
  if (!inUploadArea(layout, tempPath)) throw new Error("Uploads must come from the volume's upload area.");
  // The folder must still exist: creating it again here would bring back a folder renamed or
  // deleted while the upload finished, outside the database. Something already at the name
  // (on the disk only) is never replaced: StorageTargetExistsError.
  await renameNoReplacePath(tempPath, await pathOf(layout, location));
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
    // Gone meanwhile, or no hard links here: the caller places its own bytes. Something already
    // at the target (on the disk only): the caller's own placing reports it as a 409, not a 500.
    if (errorCode(error) === "ENOENT" || errorCode(error) === "EEXIST" || NO_HARD_LINK.has(errorCode(error))) return false;
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
  if (!inUploadArea(layout, tempPath)) throw new Error("Only the volume's upload area holds staged files.");
  // A staged copy sits in its own folder (copy-<id>/item): that folder goes with it.
  const parent = dirname(tempPath);
  const own = parent !== layout.uploads && dirname(parent) === layout.uploads;
  await rm(own ? parent : tempPath, { recursive: true, force: true });
}

/** Upload ids are generated (tus ids, `api-<uuid>`, `import-<uuid>`): one name, never a path. */
const UPLOAD_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Where an upload's bytes are received (`system/tmp/uploads/<uploadId>`). */
export function uploadPath(layout: VolumeLayout, uploadId: string): string {
  if (!UPLOAD_ID.test(uploadId)) throw new Error("Invalid upload id.");
  return join(layout.uploads, uploadId);
}

/** Receives a whole upload from `source` (through `transforms`); a partial file is removed. */
export async function stageUpload(layout: VolumeLayout, uploadId: string, source: Readable | AsyncIterable<Uint8Array>, transforms: readonly Transform[]): Promise<void> {
  const target = uploadPath(layout, uploadId);
  await mkdir(layout.uploads, { recursive: true, mode: DIR_MODE });
  try {
    const input = source instanceof Readable ? source : Readable.from(source);
    await pipeline([input, ...transforms, createWriteStream(target, { flags: "wx", mode: FILE_MODE })]);
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}

/** Bytes received for an upload so far, or null when there are none. */
export async function stagedUploadSize(layout: VolumeLayout, uploadId: string): Promise<number | null> {
  const info = await stat(uploadPath(layout, uploadId)).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  });
  return info?.size ?? null;
}

/** Removes an upload's bytes and its tus metadata (`<uploadId>.json`); missing is fine. */
export async function discardUpload(layout: VolumeLayout, uploadId: string): Promise<void> {
  const path = uploadPath(layout, uploadId);
  await Promise.all([rm(path, { force: true }), rm(`${path}.json`, { force: true })]);
}
