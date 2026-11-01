import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { DIR_MODE, type VolumeLayout } from "../layout";
import { StorageEntryMissingError, StorageTargetExistsError, type StorageLocation } from "../driver";
import { pathExists } from "./fs-errors";
import { pathOf } from "./locations";

// The volume's trash (system/trash): deleted items wait there until the daily job empties it.

/** "2026-10-06T03-12-00-000Z": when an item was moved to the trash (filename-safe ISO time). */
const trashStamp = (at: Date) => at.toISOString().replace(/[:.]/g, "-");
const TRASH_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/;
/** Hex characters of the random part of a trash entry name. */
const TRASH_NONCE_LENGTH = 8;

/** When a trash entry was moved there (from its name), or null for a name moveToTrash did not make. */
export function trashTime(name: string): number | null {
  const match = TRASH_STAMP.exec(name);
  if (!match) return null;
  const [, date, hours, minutes, seconds, millis] = match;
  return Date.parse(`${date}T${hours}:${minutes}:${seconds}.${millis}Z`);
}

export async function moveToTrash(layout: VolumeLayout, location: StorageLocation): Promise<string> {
  const source = await pathOf(layout, location);
  // A random part after the time: two items with the same name trashed in the same millisecond must not collide.
  const name = `${trashStamp(new Date())}-${randomUUID().slice(0, TRASH_NONCE_LENGTH)}-${location.accountId}-${basename(source)}`;
  const target = join(layout.trash, name);
  await mkdir(layout.trash, { recursive: true, mode: DIR_MODE });
  await rename(source, target);
  return target;
}

/**
 * The trash entry a path returned by {@link moveToTrash} names: only its entry name counts and
 * must look like one, so nothing outside the trash is reached and an entry is still found after
 * the volume was mounted at another path (`volume:init` updated mountPath).
 */
function trashEntry(layout: VolumeLayout, trashPath: string): string {
  const name = basename(trashPath);
  if (trashTime(name) === null) throw new Error("Only items in the volume's trash can be restored.");
  return join(layout.trash, name);
}

export async function restoreFromTrash(layout: VolumeLayout, trashPath: string, location: StorageLocation): Promise<void> {
  const source = trashEntry(layout, trashPath);
  const target = await pathOf(layout, location);
  // The daily job may have emptied it meanwhile.
  if (!(await pathExists(source))) throw new StorageEntryMissingError();
  // A plain rename would replace a file (or an empty folder) that is on disk under that name.
  if (await pathExists(target)) throw new StorageTargetExistsError();
  await rename(source, target);
}

export async function returnToTrash(layout: VolumeLayout, location: StorageLocation, trashPath: string): Promise<void> {
  const target = trashEntry(layout, trashPath);
  if (await pathExists(target)) throw new StorageTargetExistsError();
  await rename(await pathOf(layout, location), target);
}

export async function removeFromTrash(layout: VolumeLayout, trashPath: string): Promise<void> {
  await rm(trashEntry(layout, trashPath), { recursive: true, force: true });
}
