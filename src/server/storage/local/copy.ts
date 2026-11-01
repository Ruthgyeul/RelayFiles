import "server-only";
import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "@/config/env";
import { DIR_MODE } from "../layout";
import { errorCode, NO_HARD_LINK } from "./fs-errors";

/**
 * Whether files with the same content share their bytes (STORAGE_DEDUPE): a copy or a
 * re-upload becomes a hard link to the existing file. Files are never changed in place, so
 * the copies can never drift apart; deleting one leaves the others.
 */
export const dedupe = () => getEnv("storage").STORAGE_DEDUPE;

/** Copies one file to a path that must not exist yet: a hard link when deduplicating, else a reflink or a plain copy. */
export async function copyFileEntry(source: string, target: string): Promise<void> {
  if (dedupe()) {
    try {
      await link(source, target);
      return;
    } catch (error) {
      if (!NO_HARD_LINK.has(errorCode(error))) throw error;
    }
  }
  // Reflink when the filesystem supports it (instant copy), otherwise a normal copy.
  await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
}

/** Copies a file or a folder tree to a path that must not exist yet (folders are new, files as {@link copyFileEntry}). */
export async function copyEntry(source: string, target: string): Promise<void> {
  const info = await lstat(source);
  if (info.isFile()) return copyFileEntry(source, target);
  // A user folder holds only folders and files; anything else (a planted link) is not followed.
  if (!info.isDirectory()) throw new Error("Only files and folders can be copied.");
  await mkdir(target, { mode: DIR_MODE });
  for (const entry of await readdir(source)) await copyEntry(join(source, entry), join(target, entry));
}
