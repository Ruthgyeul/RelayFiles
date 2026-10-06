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
  space(): Promise<SpaceInfo>;
}
