import "server-only";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, open, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { DIR_MODE, FILE_MODE, layoutOf, type VolumeLayout } from "./layout";
import type { AssetKind, AssetRef, SpaceInfo, StorageDriver, StorageLocation, StorageStat } from "./driver";
import { assertNoSymlinks, resolveInsideUserRoot, userRootOf } from "./safe-path";

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
    const target = await this.pathOf(location);
    await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
    await rename(tempPath, target);
  }

  async rename(from: StorageLocation, to: StorageLocation): Promise<void> {
    const [source, target] = await Promise.all([this.pathOf(from), this.pathOf(to)]);
    await rename(source, target);
  }

  async copy(from: StorageLocation, to: StorageLocation): Promise<void> {
    const [source, target] = await Promise.all([this.pathOf(from), this.pathOf(to)]);
    const info = await stat(source);
    if (info.isDirectory()) {
      await cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    } else {
      // Reflink when the filesystem supports it (instant copy), otherwise a normal copy.
      await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    }
  }

  async moveToTrash(location: StorageLocation): Promise<string> {
    const source = await this.pathOf(location);
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${location.accountId}-${basename(source)}`;
    const target = join(this.layout.trash, name);
    await mkdir(this.layout.trash, { recursive: true, mode: DIR_MODE });
    await rename(source, target);
    return target;
  }

  async restoreFromTrash(trashPath: string, location: StorageLocation): Promise<void> {
    if (!trashPath.startsWith(this.layout.trash)) throw new Error("Only items in the volume's trash can be restored.");
    await rename(trashPath, await this.pathOf(location));
  }

  /** `system/<thumbs|derived>/<accountId>/<nodeId>`; ids are generated, never user input. */
  private assetPath(kind: AssetKind, accountId: string, nodeId: string): string {
    if (!ASSET_ID.test(accountId) || !ASSET_ID.test(nodeId)) throw new Error("Invalid asset id.");
    return join(kind === "thumb" ? this.layout.thumbs : this.layout.derived, accountId, nodeId);
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
    const kinds: AssetKind[] = ["thumb", "derived"];
    await Promise.all(nodeIds.flatMap((nodeId) => kinds.map((kind) => rm(this.assetPath(kind, accountId, nodeId), { force: true }))));
  }

  async removeAccountAssets(accountId: string): Promise<void> {
    if (!ASSET_ID.test(accountId)) throw new Error("Invalid asset id.");
    await Promise.all([this.layout.thumbs, this.layout.derived].map((dir) => rm(join(dir, accountId), { recursive: true, force: true })));
  }

  async space(): Promise<SpaceInfo> {
    const info = await statfs(this.layout.root, { bigint: true });
    return { total: info.blocks * info.bsize, available: info.bavail * info.bsize };
  }
}
