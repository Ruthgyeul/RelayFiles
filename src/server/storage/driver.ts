import "server-only";
import type { Readable } from "node:stream";
import type { DiskEntry } from "@/domain/fsck";
import type { ASSET_DIRS } from "./layout";

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
export type AssetKind = keyof typeof ASSET_DIRS;

export interface AssetRef {
  kind: AssetKind;
  accountId: string;
  nodeId: string;
}

/** Bytes served from something other than the stored file: its size, and a reader for a range of it. */
export interface ByteSource {
  size: number;
  /** Opens the bytes `start`..`end` (inclusive), or all of them. */
  open(range?: { start: number; end: number }): Promise<Readable>;
}

/** {@link StorageDriver.renameNoReplace} found something at the target name. */
export class StorageTargetExistsError extends Error {
  constructor() {
    super("The target name already exists on the volume.");
    this.name = "StorageTargetExistsError";
  }
}

export interface SpaceInfo {
  total: bigint;
  available: bigint;
}

/**
 * Storage backend contract (docs/architecture.md "교체 가능한 인터페이스"). Services use only this interface,
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
  /** Moves a finished upload or staged copy from the temp area into place without copying bytes; the folder must exist. */
  moveIntoPlace(tempPath: string, location: StorageLocation): Promise<void>;
  /**
   * Places a hard link to an existing file of the same account at `to` (deduplication of a
   * re-upload with the same SHA-256). False when that is not possible here (deduplication off,
   * the file is gone or has another size, no hard links): the caller then places its own bytes.
   */
  linkExisting(from: StorageLocation, to: StorageLocation, size: number): Promise<boolean>;
  /** Copies an item into the temp area (hard links when deduplicating, else reflinks when possible) and returns its path, for {@link moveIntoPlace}. */
  stageCopy(from: StorageLocation): Promise<string>;
  /** Removes a staged copy or upload from the temp area (missing is fine). */
  discardStaged(tempPath: string): Promise<void>;
  rename(from: StorageLocation, to: StorageLocation): Promise<void>;
  /**
   * Renames a file only if nothing exists at `to` (a plain rename replaces it). Throws
   * {@link StorageTargetExistsError} when the name is taken, leaving both files untouched.
   */
  renameNoReplace(from: StorageLocation, to: StorageLocation): Promise<void>;
  copy(from: StorageLocation, to: StorageLocation): Promise<void>;
  /** Moves an item (or a whole account root when segments is empty) to the trash area. */
  moveToTrash(location: StorageLocation): Promise<string>;
  /** Puts an item moved to the trash back (undo of a failed delete). */
  restoreFromTrash(trashPath: string, location: StorageLocation): Promise<void>;
  space(): Promise<SpaceInfo>;
  /** Writes a generated file atomically (temp file + rename), replacing an older one. */
  writeAsset(asset: AssetRef, data: Uint8Array): Promise<void>;
  /** Moves a generated file written in the temp area (a video conversion) into place, replacing an older one. */
  adoptAsset(asset: AssetRef, tempPath: string): Promise<void>;
  /** A path in the temp area for a generated file that is too large to hold in memory. */
  stagingPath(): Promise<string>;
  /** Reads a generated file, or null when it does not exist. */
  readAsset(asset: AssetRef): Promise<{ stream: Readable; size: number } | null>;
  /** A generated file as a ranged source (nothing stays open until it is read), or null when missing. */
  assetSource(asset: AssetRef): Promise<ByteSource | null>;
  /** Removes the generated files of these nodes (missing ones are ignored). */
  removeAssets(accountId: string, nodeIds: readonly string[]): Promise<void>;
  /**
   * Permanently removes trash entries moved there before `trashBefore` and unfinished uploads
   * last written before `uploadsBefore`. Returns how many entries were removed.
   */
  purgeSystem(trashBefore: Date, uploadsBefore: Date, transcodedBefore: Date): Promise<{ trash: number; uploads: number; transcoded: number }>;
  /** Removes every generated file of an account (account deletion). */
  removeAccountAssets(accountId: string): Promise<void>;
  /** True when the upload staging area accepts a write (Status page probe). */
  canWrite(): Promise<boolean>;
  /**
   * Everything below an account root, by path ("Trip/a.txt"), for npm run storage:fsck.
   * Symbolic links and other special files are reported as "other" and never followed.
   */
  listTree(accountId: string): Promise<Map<string, DiskEntry>>;
  /** Account ids that have a root folder on this volume. */
  listAccountRoots(): Promise<string[]>;
}
