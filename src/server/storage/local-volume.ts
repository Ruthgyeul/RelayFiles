import "server-only";
import type { Readable } from "node:stream";
import type { DiskEntry } from "@/domain/fsck";
import { layoutOf, type VolumeLayout } from "./layout";
import type { AssetRef, ByteSource, CopyEntry, SpaceInfo, StorageDriver, StorageLocation, StorageStat } from "./driver";
import * as assets from "./local/assets";
import * as listing from "./local/listing";
import * as locations from "./local/locations";
import * as maintenance from "./local/maintenance";
import * as staging from "./local/staging";
import * as trash from "./local/trash";

/**
 * Storage on a locally mounted volume (the external SSD at /mnt/relayfilesDB).
 * Files keep their original bytes and real names; folders mirror the app's folder tree.
 *
 * The work lives in `./local/`, one module per area: locations in an account's tree, staging in
 * the upload area, the trash, generated files, maintenance and listing. This class only binds
 * them to the volume's layout (methods stay on the prototype, where tests replace them).
 */
export class LocalVolumeDriver implements StorageDriver {
  private readonly layout: VolumeLayout;

  constructor(
    readonly volumeId: string,
    root: string,
  ) {
    this.layout = layoutOf(root);
  }

  ensureUserRoot(accountId: string): Promise<void> {
    return locations.ensureUserRoot(this.layout, accountId);
  }

  localPath(location: StorageLocation): Promise<string> {
    return locations.pathOf(this.layout, location);
  }

  stat(location: StorageLocation): Promise<StorageStat | null> {
    return locations.statLocation(this.layout, location);
  }

  createReadStream(location: StorageLocation, range?: { start: number; end: number }): Promise<Readable> {
    return locations.readStream(this.layout, location, range);
  }

  createFolder(location: StorageLocation): Promise<void> {
    return locations.createFolder(this.layout, location);
  }

  rename(from: StorageLocation, to: StorageLocation): Promise<void> {
    return locations.renameLocation(this.layout, from, to);
  }

  renameNoReplace(from: StorageLocation, to: StorageLocation): Promise<void> {
    return locations.renameNoReplace(this.layout, from, to);
  }

  copy(from: StorageLocation, to: StorageLocation): Promise<void> {
    return locations.copyLocation(this.layout, from, to);
  }

  moveIntoPlace(tempPath: string, location: StorageLocation): Promise<void> {
    return staging.moveIntoPlace(this.layout, tempPath, location);
  }

  linkExisting(from: StorageLocation, to: StorageLocation, size: number): Promise<boolean> {
    return staging.linkExisting(this.layout, from, to, size);
  }

  stageCopy(from: StorageLocation, entries: readonly CopyEntry[]): Promise<string> {
    return staging.stageCopy(this.layout, from, entries);
  }

  discardStaged(tempPath: string): Promise<void> {
    return staging.discardStaged(this.layout, tempPath);
  }

  moveToTrash(location: StorageLocation): Promise<string> {
    return trash.moveToTrash(this.layout, location);
  }

  restoreFromTrash(trashPath: string, location: StorageLocation): Promise<void> {
    return trash.restoreFromTrash(this.layout, trashPath, location);
  }

  returnToTrash(location: StorageLocation, trashPath: string): Promise<void> {
    return trash.returnToTrash(this.layout, location, trashPath);
  }

  removeFromTrash(trashPath: string): Promise<void> {
    return trash.removeFromTrash(this.layout, trashPath);
  }

  writeAsset(asset: AssetRef, data: Uint8Array): Promise<void> {
    return assets.writeAsset(this.layout, asset, data);
  }

  stagingPath(): Promise<string> {
    return assets.stagingPath(this.layout);
  }

  adoptAsset(asset: AssetRef, tempPath: string): Promise<void> {
    return assets.adoptAsset(this.layout, asset, tempPath);
  }

  assetSource(asset: AssetRef): Promise<ByteSource | null> {
    return assets.assetSource(this.layout, asset);
  }

  readAsset(asset: AssetRef): Promise<{ stream: Readable; size: number } | null> {
    return assets.readAsset(this.layout, asset);
  }

  removeAssets(accountId: string, nodeIds: readonly string[]): Promise<void> {
    return assets.removeAssets(this.layout, accountId, nodeIds);
  }

  removeAccountAssets(accountId: string): Promise<void> {
    return assets.removeAccountAssets(this.layout, accountId);
  }

  purgeSystem(trashBefore: Date, uploadsBefore: Date, transcodedBefore: Date): Promise<{ trash: number; uploads: number; transcoded: number }> {
    return maintenance.purgeSystem(this.layout, trashBefore, uploadsBefore, transcodedBefore);
  }

  canWrite(): Promise<boolean> {
    return maintenance.canWrite(this.layout);
  }

  space(): Promise<SpaceInfo> {
    return maintenance.space(this.layout);
  }

  listTree(accountId: string): Promise<Map<string, DiskEntry>> {
    return listing.listTree(this.layout, accountId);
  }

  listAccountRoots(): Promise<string[]> {
    return listing.listAccountRoots(this.layout);
  }
}
