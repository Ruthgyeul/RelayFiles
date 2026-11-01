import "server-only";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, link, lstat, mkdir, open, readdir, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { getEnv } from "@/config/env";
import { basename, dirname, join, sep } from "node:path";
import type { Readable } from "node:stream";
import { ASSET_DIRS, DIR_MODE, FILE_MODE, layoutOf, type VolumeLayout } from "./layout";
import type { DiskEntry } from "@/domain/fsck";
import { StorageEntryMissingError, StorageTargetExistsError, type AssetKind, type AssetRef, type ByteSource, type CopyEntry, type SpaceInfo, type StorageDriver, type StorageLocation, type StorageStat } from "./driver";
import { assertNoSymlinks, resolveInsideUserRoot, userRootOf } from "./safe-path";

/** "2026-10-06T03-12-00-000Z": when an item was moved to the trash (filename-safe ISO time). */
const trashStamp = (at: Date) => at.toISOString().replace(/[:.]/g, "-");
const TRASH_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/;
/** Hex characters of the random part of a trash entry name. */
const TRASH_NONCE_LENGTH = 8;
/** Name of the copied item inside its staging folder (`system/tmp/uploads/copy-<id>/item`). */
const STAGED_ITEM = "item";

function trashTime(name: string): number | null {
  const match = TRASH_STAMP.exec(name);
  if (!match) return null;
  const [, date, hours, minutes, seconds, millis] = match;
  return Date.parse(`${date}T${hours}:${minutes}:${seconds}.${millis}Z`);
}

/** Errors meaning "no hard link here" (another filesystem, too many links, not supported): copy instead. */
const NO_HARD_LINK = new Set(["EXDEV", "EMLINK", "EPERM", "ENOTSUP", "EOPNOTSUPP"]);
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code ?? "";

/** True when something (a file, folder or link) exists at `path`. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

/**
 * Whether files with the same content share their bytes (STORAGE_DEDUPE): a copy or a
 * re-upload becomes a hard link to the existing file. Files are never changed in place, so
 * the copies can never drift apart; deleting one leaves the others.
 */
const dedupe = () => getEnv("storage").STORAGE_DEDUPE;

/** Copies one file to a path that must not exist yet: a hard link when deduplicating, else a reflink or a plain copy. */
async function copyFileEntry(source: string, target: string): Promise<void> {
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
async function copyEntry(source: string, target: string): Promise<void> {
  const info = await lstat(source);
  if (info.isFile()) return copyFileEntry(source, target);
  // A user folder holds only folders and files; anything else (a planted link) is not followed.
  if (!info.isDirectory()) throw new Error("Only files and folders can be copied.");
  await mkdir(target, { mode: DIR_MODE });
  for (const entry of await readdir(source)) await copyEntry(join(source, entry), join(target, entry));
}

/** Account and node ids (generated, lowercase alphanumerics). */
const ASSET_ID = /^[a-z0-9]{6,32}$/;

/**
 * Storage on a locally mounted volume (the external SSD at /mnt/relayfilesDB).
 * Files keep their original bytes and real names; folders mirror the app's folder tree.
 */
export class LocalVolumeDriver implements StorageDriver {
  private readonly layout: VolumeLayout;

  constructor(
    readonly volumeId: string,
    root: string,
  ) {
    this.layout = layoutOf(root);
  }

  /** Resolves and checks a location: inside the account root and free of symbolic links. */
  private async pathOf({ accountId, segments }: StorageLocation): Promise<string> {
    const target = resolveInsideUserRoot(this.layout.root, accountId, segments);
    await assertNoSymlinks(userRootOf(this.layout.root, accountId), target);
    return target;
  }

  async ensureUserRoot(accountId: string): Promise<void> {
    await mkdir(userRootOf(this.layout.root, accountId), { recursive: true, mode: DIR_MODE });
  }

  async localPath(location: StorageLocation): Promise<string> {
    return this.pathOf(location);
  }

  async stat(location: StorageLocation): Promise<StorageStat | null> {
    try {
      const info = await stat(await this.pathOf(location), { bigint: true });
      return { type: info.isDirectory() ? "folder" : "file", size: info.size, modifiedAt: info.mtime };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async createReadStream(location: StorageLocation, range?: { start: number; end: number }): Promise<Readable> {
    // O_NOFOLLOW: refuse to open the final component if it was swapped for a symlink.
    const handle = await open(await this.pathOf(location), constants.O_RDONLY | constants.O_NOFOLLOW);
    return handle.createReadStream({ ...range, autoClose: true });
  }

  async createFolder(location: StorageLocation): Promise<void> {
    await mkdir(await this.pathOf(location), { mode: DIR_MODE });
  }

  async moveIntoPlace(tempPath: string, location: StorageLocation): Promise<void> {
    if (!tempPath.startsWith(this.layout.uploads)) throw new Error("Uploads must come from the volume's upload area.");
    // The folder must still exist: creating it again here would bring back a folder renamed or
    // deleted while the upload finished, outside the database.
    await rename(tempPath, await this.pathOf(location));
  }

  async linkExisting(from: StorageLocation, to: StorageLocation, size: number): Promise<boolean> {
    if (!dedupe()) return false;
    try {
      const source = await this.pathOf(from);
      const info = await lstat(source);
      if (!info.isFile() || info.size !== size) return false;
      await link(source, await this.pathOf(to));
      return true;
    } catch (error) {
      // Gone meanwhile, or no hard links here: the caller places its own bytes.
      if (errorCode(error) === "ENOENT" || NO_HARD_LINK.has(errorCode(error))) return false;
      throw error;
    }
  }

  async stageCopy(from: StorageLocation, entries: readonly CopyEntry[]): Promise<string> {
    // The item's own path is checked like any other (inside the account root, no links).
    await this.pathOf(from);
    await mkdir(this.layout.uploads, { recursive: true, mode: DIR_MODE });
    // Its own new folder: the cleanup reads the folder's time, not the time of hard-linked files,
    // which keep the original's (an old file copied just now must not look abandoned).
    const dir = join(this.layout.uploads, `copy-${randomUUID()}`);
    await mkdir(dir, { mode: DIR_MODE });
    const target = join(dir, STAGED_ITEM);
    try {
      // Parents come before children, so every folder on a file's path was checked to be a real folder.
      for (const entry of entries) {
        const source = resolveInsideUserRoot(this.layout.root, from.accountId, [...from.segments, ...entry.segments]);
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

  async discardStaged(tempPath: string): Promise<void> {
    if (!tempPath.startsWith(this.layout.uploads + sep)) throw new Error("Only the volume's upload area holds staged files.");
    // A staged copy sits in its own folder (copy-<id>/item): that folder goes with it.
    const parent = dirname(tempPath);
    const own = parent !== this.layout.uploads && dirname(parent) === this.layout.uploads;
    await rm(own ? parent : tempPath, { recursive: true, force: true });
  }

  async rename(from: StorageLocation, to: StorageLocation): Promise<void> {
    const [source, target] = await Promise.all([this.pathOf(from), this.pathOf(to)]);
    await rename(source, target);
  }

  async renameNoReplace(from: StorageLocation, to: StorageLocation): Promise<void> {
    const [source, target] = await Promise.all([this.pathOf(from), this.pathOf(to)]);
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

  async copy(from: StorageLocation, to: StorageLocation): Promise<void> {
    const [source, target] = await Promise.all([this.pathOf(from), this.pathOf(to)]);
    await copyEntry(source, target);
  }

  async moveToTrash(location: StorageLocation): Promise<string> {
    const source = await this.pathOf(location);
    // A random part after the time: two items with the same name trashed in the same millisecond must not collide.
    const name = `${trashStamp(new Date())}-${randomUUID().slice(0, TRASH_NONCE_LENGTH)}-${location.accountId}-${basename(source)}`;
    const target = join(this.layout.trash, name);
    await mkdir(this.layout.trash, { recursive: true, mode: DIR_MODE });
    await rename(source, target);
    return target;
  }

  async restoreFromTrash(trashPath: string, location: StorageLocation): Promise<void> {
    if (!trashPath.startsWith(this.layout.trash)) throw new Error("Only items in the volume's trash can be restored.");
    await rename(trashPath, await this.pathOf(location));
  }

  /** `system/<thumbs|derived|previews|transcoded>/<accountId>/<nodeId>`; ids are generated, never user input. */
  private assetPath(kind: AssetKind, accountId: string, nodeId: string): string {
    if (!ASSET_ID.test(accountId) || !ASSET_ID.test(nodeId)) throw new Error("Invalid asset id.");
    return join(this.layout[ASSET_DIRS[kind]], accountId, nodeId);
  }

  async writeAsset({ kind, accountId, nodeId }: AssetRef, data: Uint8Array): Promise<void> {
    const target = this.assetPath(kind, accountId, nodeId);
    await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, data, { mode: FILE_MODE, flag: "wx" });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async stagingPath(): Promise<string> {
    await mkdir(this.layout.uploads, { recursive: true, mode: DIR_MODE });
    return join(this.layout.uploads, `asset-${randomUUID()}`);
  }

  async adoptAsset({ kind, accountId, nodeId }: AssetRef, tempPath: string): Promise<void> {
    if (!tempPath.startsWith(this.layout.uploads)) throw new Error("Generated files must come from the volume's upload area.");
    const target = this.assetPath(kind, accountId, nodeId);
    await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
    await rename(tempPath, target);
  }

  async assetSource({ kind, accountId, nodeId }: AssetRef): Promise<ByteSource | null> {
    const path = this.assetPath(kind, accountId, nodeId);
    const openAsset = () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let size: number;
    try {
      const handle = await openAsset();
      try {
        size = (await handle.stat()).size;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return { size, open: async (range) => (await openAsset()).createReadStream({ ...range, autoClose: true }) };
  }

  async readAsset({ kind, accountId, nodeId }: AssetRef): Promise<{ stream: Readable; size: number } | null> {
    try {
      const handle = await open(this.assetPath(kind, accountId, nodeId), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      return { stream: handle.createReadStream({ autoClose: true }), size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async removeAssets(accountId: string, nodeIds: readonly string[]): Promise<void> {
    const kinds = Object.keys(ASSET_DIRS) as AssetKind[];
    await Promise.all(nodeIds.flatMap((nodeId) => kinds.map((kind) => rm(this.assetPath(kind, accountId, nodeId), { force: true }))));
  }

  async purgeSystem(trashBefore: Date, uploadsBefore: Date, transcodedBefore: Date): Promise<{ trash: number; uploads: number; transcoded: number }> {
    const entries = async (dir: string) => readdir(dir).catch(() => [] as string[]);
    let trash = 0;
    for (const name of await entries(this.layout.trash)) {
      // Entries start with the time they were moved (the item keeps its own mtime).
      const movedAt = trashTime(name);
      if (movedAt === null || movedAt >= trashBefore.getTime()) continue;
      await rm(join(this.layout.trash, name), { recursive: true, force: true });
      trash++;
    }
    let uploads = 0;
    for (const name of await entries(this.layout.uploads)) {
      const path = join(this.layout.uploads, name);
      // The entry's own time: an upload's last write, or when a copy's staging folder was filled
      // (never the time of the files inside it: hard links keep the original's).
      const info = await lstat(path).catch(() => null);
      if (!info || info.mtime >= uploadsBefore) continue;
      await rm(path, { recursive: true, force: true });
      uploads++;
    }
    // Conversions are made again after a few more plays; old ones only take space.
    let transcoded = 0;
    for (const account of await entries(this.layout.transcoded)) {
      const dir = join(this.layout.transcoded, account);
      for (const name of await entries(dir)) {
        const path = join(dir, name);
        const info = await lstat(path).catch(() => null);
        if (!info || info.mtime >= transcodedBefore) continue;
        await rm(path, { force: true });
        transcoded++;
      }
    }
    return { trash, uploads, transcoded };
  }

  async removeAccountAssets(accountId: string): Promise<void> {
    if (!ASSET_ID.test(accountId)) throw new Error("Invalid asset id.");
    await Promise.all(Object.values(ASSET_DIRS).map((dir) => rm(join(this.layout[dir], accountId), { recursive: true, force: true })));
  }

  async canWrite(): Promise<boolean> {
    const probe = join(this.layout.uploads, `.probe-${randomUUID()}`);
    try {
      await writeFile(probe, "", { mode: FILE_MODE, flag: "wx" });
      return true;
    } catch {
      return false;
    } finally {
      await rm(probe, { force: true });
    }
  }

  async listTree(accountId: string): Promise<Map<string, DiskEntry>> {
    const root = userRootOf(this.layout.root, accountId);
    const found = new Map<string, DiskEntry>();
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const name of await readdir(dir)) {
        const path = prefix ? `${prefix}/${name}` : name;
        const info = await lstat(join(dir, name), { bigint: true });
        if (info.isDirectory()) {
          found.set(path, { type: "folder", size: 0n });
          await walk(join(dir, name), path);
        } else {
          found.set(path, { type: info.isFile() ? "file" : "other", size: info.isFile() ? info.size : 0n });
        }
      }
    };
    await walk(root, "");
    return found;
  }

  async listAccountRoots(): Promise<string[]> {
    const names = await readdir(this.layout.users).catch(() => [] as string[]);
    return names.filter((name) => ASSET_ID.test(name));
  }

  async space(): Promise<SpaceInfo> {
    const info = await statfs(this.layout.root, { bigint: true });
    return { total: info.blocks * info.bsize, available: info.bavail * info.bsize };
  }
}
