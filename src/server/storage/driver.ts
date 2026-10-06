import "server-only";
import type { Readable } from "node:stream";

/** Location of a file or folder: account plus folder names from the account root down. */
export interface StorageLocation {
  accountId: string;
  segments: readonly string[];
}

export interface StorageStat {
  type: "file" | "folder";
  size: bigint;
  modifiedAt: Date;
}

/** Files generated from an original: a thumbnail, or the metadata-stripped copy for public links. */
export type AssetKind = "thumb" | "derived";

export interface AssetRef {
  kind: AssetKind;
  accountId: string;
  nodeId: string;
}

export interface SpaceInfo {
  total: bigint;
  available: bigint;
}

/**
 * Storage backend contract (docs/plan.md §13.5 "확장성"). Services use only this interface,
 * so a second SSD or an S3/MinIO backend can be added without changing them.
 */
export interface StorageDriver {
  readonly volumeId: string;
  /** Creates the account root folder if needed. */
  ensureUserRoot(accountId: string): Promise<void>;
  /** Absolute filesystem path for direct serving (X-Accel); undefined for remote drivers. */
  localPath(location: StorageLocation): Promise<string | undefined>;
  stat(location: StorageLocation): Promise<StorageStat | null>;
  createReadStream(location: StorageLocation, range?: { start: number; end: number }): Promise<Readable>;
  createFolder(location: StorageLocation): Promise<void>;
  /** Moves a finished upload from the temp area into place without copying bytes. */
  moveIntoPlace(tempPath: string, location: StorageLocation): Promise<void>;
  rename(from: StorageLocation, to: StorageLocation): Promise<void>;
  copy(from: StorageLocation, to: StorageLocation): Promise<void>;
  /** Moves an item (or a whole account root when segments is empty) to the trash area. */
  moveToTrash(location: StorageLocation): Promise<string>;
  /** Puts an item moved to the trash back (undo of a failed delete). */
  restoreFromTrash(trashPath: string, location: StorageLocation): Promise<void>;
  space(): Promise<SpaceInfo>;
  /** Writes a generated file atomically (temp file + rename), replacing an older one. */
  writeAsset(asset: AssetRef, data: Uint8Array): Promise<void>;
  /** Reads a generated file, or null when it does not exist. */
  readAsset(asset: AssetRef): Promise<{ stream: Readable; size: number } | null>;
  /** Removes the generated files of these nodes (missing ones are ignored). */
  removeAssets(accountId: string, nodeIds: readonly string[]): Promise<void>;
  /**
   * Permanently removes trash entries moved there before `trashBefore` and unfinished uploads
   * last written before `uploadsBefore`. Returns how many entries were removed.
   */
  purgeSystem(trashBefore: Date, uploadsBefore: Date): Promise<{ trash: number; uploads: number }>;
  /** Removes every generated file of an account (account deletion). */
  removeAccountAssets(accountId: string): Promise<void>;
  /** True when the upload staging area accepts a write (Status page probe). */
  canWrite(): Promise<boolean>;
}
