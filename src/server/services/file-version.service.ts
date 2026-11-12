import "server-only";
import { getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import type { FileVersionDto } from "@/contracts/nodes";
import { newFileVersionId, newLinkId, newNodeId } from "@/domain/ids";
import { kindFromMime } from "@/domain/upload";
import { db, type DbClient } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { enqueueMedia } from "../jobs/queue";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { favoriteFoldersOf, moveFavoriteToNode, removeFavorites } from "../repositories/favorite.repo";
import { createFileVersion, deleteFileVersion, deleteFileVersions, expiredFileVersions, findFileVersion, listFileVersions, moveVersionsToNode } from "../repositories/file-version.repo";
import { moveLinkEvents } from "../repositories/link-event.repo";
import { carriedSettingsOf, createFileNode, deleteNodes, findNode, updateNode, type NodeRow } from "../repositories/node.repo";
import { recordTrashed } from "../repositories/trash.repo";
import { StorageTargetExistsError, type ByteSource, type StorageDriver, type StorageLocation } from "../storage/driver";
import { driverFor } from "../storage/registry";
import { withStorageTransaction, type UndoStack } from "../storage/storage-transaction";
import { findVolume } from "../repositories/volume.repo";
import { locationOf } from "./node-location";
import { driverForAccount, lockAccountForWrite } from "./volume.service";

type Owner = Pick<AccountRow, "id" | "volumeId" | "isAdmin" | "quotaBytes">;

/** Expired versions removed per round of the daily cleanup. */
const PURGE_BATCH = 500;

/** Days an earlier version is kept (FILE_VERSIONS_DAYS); 0 keeps none. */
export function fileVersionsDays(): number {
  return getEnv("storage").FILE_VERSIONS_DAYS;
}

/** A name no upload can have (names are validated), held by a replaced row until it is deleted. */
export const replacedName = (nodeId: string) => `replaced/${nodeId}`;

/** What {@link setAside} did with the replaced bytes, to record once the new row exists. */
export interface SetAside {
  /** Records the kept version for the row that now holds the file (no-op when nothing was kept). */
  recordFor(tx: DbClient, nodeId: string): Promise<void>;
}

/**
 * Inside a storage transaction: moves the bytes of `row` (at `location`) out of the way before
 * new content takes its place. With FILE_VERSIONS_DAYS above 0 they become an earlier version;
 * otherwise they go to the trash as before. The old row steps aside too (its name and link go to
 * the new row, see {@link handOver}).
 */
export async function setAside(tx: DbClient, driver: StorageDriver, undo: UndoStack, accountId: string, row: NodeRow, location: StorageLocation): Promise<SetAside> {
  let recordFor: SetAside["recordFor"] = async () => undefined;
  if (fileVersionsDays() > 0) {
    const ref = { accountId, versionId: newFileVersionId() };
    await driver.moveToVersion(location, ref);
    undo.push("put the replaced file back", () => driver.restoreVersion(ref, location));
    recordFor = (client, nodeId) =>
      createFileVersion(client, { id: ref.versionId, nodeId, accountId, size: row.size, sha256: row.sha256, mime: row.mime, modifiedAt: row.modifiedAt ?? row.createdAt });
  } else {
    const trashed = await driver.moveToTrash(location);
    undo.push("restore replaced file", () => driver.restoreFromTrash(trashed, location));
    await recordTrashed(tx, accountId, row.size);
  }
  await updateNode(tx, row.id, { name: replacedName(row.id), linkId: newLinkId() });
  return { recordFor };
}

/**
 * The new row takes over what belongs to the file rather than to its bytes: share link history,
 * its place in Favorites and its earlier versions. Then the old row goes.
 */
export async function handOver(tx: DbClient, from: NodeRow, toNodeId: string): Promise<void> {
  await moveLinkEvents(tx, from.id, toNodeId);
  await moveFavoriteToNode(tx, from.id, toNodeId);
  await moveVersionsToNode(tx, from.id, toNodeId);
  await deleteNodes(tx, [from.id]);
}

/**
 * A file moved over another file (WebDAV MOVE with Overwrite, the way editors save: write a
 * temporary file, then rename it over the original). The moved file takes the other's place
 * like an upload with "Replace": the replaced bytes become an earlier version (or go to the
 * trash), and the moved row takes over the share link, its settings, tags, history, place in
 * Favorites and versions. Both must be files of `owner`.
 */
export async function moveOverFile(owner: Owner, source: NodeRow, target: NodeRow): Promise<void> {
  const parentId = target.parentId;
  if (source.type !== "FILE" || target.type !== "FILE" || !parentId) throw new ApiError("CONFLICT", "Only a file can replace a file.");
  const driver = await driverForAccount(owner, "write");
  const [from, to] = await Promise.all([locationOf(owner.id, source.id), locationOf(owner.id, target.id)]);
  await withStorageTransaction(db(), async (tx, undo) => {
    await lockAccountForWrite(tx, owner.id, driver.volumeId);
    const aside = await setAside(tx, driver, undo, owner.id, target, to);
    // One place in Favorites per file: the replaced file's place wins.
    if ((await favoriteFoldersOf(tx, [target.id])).has(target.id)) await removeFavorites(tx, owner.id, [source.id]);
    await updateNode(tx, source.id, { parent: { connect: { id: parentId } }, name: target.name, ...carriedSettingsOf(target) });
    await driver.renameNoReplace(from, to);
    undo.push("undo move", () => driver.renameNoReplace(to, from));
    await aside.recordFor(tx, source.id);
    await handOver(tx, target, source.id);
  });
  await driver.removeAssets(owner.id, [target.id]).catch((error: unknown) => logger.warn("old media assets not removed", { error }));
}

async function requireFile(accountId: string, nodeId: string): Promise<NodeRow> {
  const row = await findNode(db(), accountId, nodeId);
  if (!row || row.type !== "FILE") throw new ApiError("NOT_FOUND");
  return row;
}

function toDto(version: { id: string; size: bigint; mime: string | null; modifiedAt: Date | null; createdAt: Date }, days: number): FileVersionDto {
  return {
    id: version.id,
    size: version.size.toString(),
    mime: version.mime,
    modifiedAt: version.modifiedAt?.toISOString() ?? null,
    replacedAt: version.createdAt.toISOString(),
    expiresAt: new Date(version.createdAt.getTime() + days * MS.day).toISOString(),
  };
}

/** A file's earlier versions, newest first; another account's file is 404. */
export async function fileVersions(accountId: string, nodeId: string): Promise<FileVersionDto[]> {
  await requireFile(accountId, nodeId);
  const days = fileVersionsDays();
  return (await listFileVersions(db(), accountId, nodeId)).map((version) => toDto(version, days));
}

/** The bytes of an earlier version, for "Download". */
export async function fileVersionContent(
  owner: Owner,
  nodeId: string,
  versionId: string,
): Promise<{ driver: StorageDriver; name: string; mime: string | null; sha256: string | null; source: ByteSource }> {
  const row = await requireFile(owner.id, nodeId);
  const version = await findFileVersion(db(), owner.id, nodeId, versionId);
  if (!version) throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner, "read");
  const source = await driver.assetSource({ kind: "version", accountId: owner.id, nodeId: version.id });
  if (!source) throw new ApiError("NOT_FOUND");
  return { driver, name: row.name, mime: version.mime, sha256: version.sha256, source };
}

/**
 * Makes an earlier version the current file again. The current file becomes a version itself, so
 * nothing is lost, and like an upload that replaces a file the restored content gets a new node
 * id that keeps the share link, its settings, tags, favorites and versions.
 */
export async function restoreFileVersion(owner: Owner, nodeId: string, versionId: string): Promise<{ nodeId: string }> {
  const row = await requireFile(owner.id, nodeId);
  const version = await findFileVersion(db(), owner.id, nodeId, versionId);
  if (!version) throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner, "write");
  const location = await locationOf(owner.id, row.id);
  const ref = { accountId: owner.id, versionId: version.id };
  const current = { accountId: owner.id, versionId: newFileVersionId() };
  try {
    const placed = await withStorageTransaction(db(), async (tx, undo) => {
      await lockAccountForWrite(tx, owner.id, driver.volumeId);
      // Read again under the lock: a second restore or an upload may have replaced it meanwhile.
      const now = await findNode(tx, owner.id, row.id);
      if (!now || now.type !== "FILE" || !(await deleteFileVersion(tx, owner.id, version.id))) throw new ApiError("CONFLICT", "This file changed. Reload and try again.");
      await driver.moveToVersion(location, current);
      undo.push("put the current file back", () => driver.restoreVersion(current, location));
      await driver.restoreVersion(ref, location);
      undo.push("put the version back", () => driver.moveToVersion(location, ref));
      await updateNode(tx, now.id, { name: replacedName(now.id), linkId: newLinkId() });
      const mime = version.mime ?? now.mime ?? "application/octet-stream";
      const created = await createFileNode(tx, {
        id: newNodeId(),
        accountId: owner.id,
        parentId: now.parentId!,
        name: now.name,
        kind: kindFromMime(mime).toUpperCase() as "VIDEO" | "AUDIO" | "IMAGE" | "OTHER",
        mime,
        size: version.size,
        sha256: version.sha256,
        modifiedAt: version.modifiedAt ?? version.createdAt,
        ...carriedSettingsOf(now),
      });
      await createFileVersion(tx, { id: current.versionId, nodeId: created.id, accountId: owner.id, size: now.size, sha256: now.sha256, mime: now.mime, modifiedAt: now.modifiedAt ?? now.createdAt });
      await handOver(tx, now, created.id);
      return created;
    });
    await driver.removeAssets(owner.id, [row.id]).catch((error: unknown) => logger.warn("old media assets not removed", { error }));
    if (placed.kind === "IMAGE" || placed.kind === "VIDEO") void enqueueMedia([placed.id]);
    return { nodeId: placed.id };
  } catch (caught) {
    if (caught instanceof StorageTargetExistsError || isUniqueViolation(caught)) throw new ApiError("CONFLICT", "This file changed. Reload and try again.");
    throw caught;
  }
}

/** Deletes an earlier version for good ("Delete" in Version history). */
export async function removeFileVersion(owner: Owner, nodeId: string, versionId: string): Promise<void> {
  await requireFile(owner.id, nodeId);
  const version = await findFileVersion(db(), owner.id, nodeId, versionId);
  if (!version || !(await deleteFileVersion(db(), owner.id, version.id))) throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner, "write");
  await driver.removeVersion({ accountId: owner.id, versionId: version.id });
}

/**
 * Daily cleanup: versions older than FILE_VERSIONS_DAYS (all of them when it is 0), including
 * those of deleted files. Bytes first, then the rows: a row whose bytes could not be removed
 * (volume offline) stays and is tried again the next day. Returns how many went.
 */
export async function purgeExpiredVersions(now: Date): Promise<number> {
  const before = new Date(now.getTime() - fileVersionsDays() * MS.day);
  let removed = 0;
  for (;;) {
    const batch = await expiredFileVersions(db(), before, PURGE_BATCH);
    if (batch.length === 0) return removed;
    const done: string[] = [];
    const drivers = new Map<string, StorageDriver | null>();
    for (const version of batch) {
      const volumeId = version.account.volumeId;
      if (!drivers.has(volumeId)) {
        const volume = await findVolume(db(), volumeId);
        drivers.set(volumeId, volume && (volume.status === "ACTIVE" || volume.status === "DRAINING") ? driverFor(volume) : null);
      }
      const driver = drivers.get(volumeId);
      if (!driver) continue;
      try {
        await driver.removeVersion({ accountId: version.accountId, versionId: version.id });
        done.push(version.id);
      } catch (error) {
        logger.warn("expired version not removed", { error });
      }
    }
    removed += await deleteFileVersions(db(), done);
    // Nothing removable left in this round (all on unavailable volumes): try again tomorrow.
    if (done.length < batch.length) return removed;
  }
}
