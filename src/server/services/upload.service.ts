import "server-only";
import { createReadStream } from "node:fs";
import { rm, stat, unlink } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { STORAGE } from "@/config/policy";
import type { PrepareUploadInput, PrepareUploadResult, UploadedFile } from "@/contracts/uploads";
import { randomString, ID_ALPHABET, newLinkId, newNodeId } from "@/domain/ids";
import { nameError, uniqName } from "@/domain/names";
import { folderCount, homeUploadPlan, kindFromMime, mimeFromName, uploadFallbackName } from "@/domain/upload";
import { segmentsBelowRoot } from "@/domain/tree";
import { db } from "../db/client";
import { retryOnUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { carriedSettingsOf, createFileNode, createFolderNode, deleteNodes, findChildByName, findFileWithContent, findNode, findRootFolder, listSiblingNames, updateNode, type NodeRow } from "../repositories/node.repo";
import { moveLinkEvents } from "../repositories/link-event.repo";
import { ancestorChain, relativePaths } from "../repositories/node-tree.repo";
import { findVolume } from "../repositories/volume.repo";
import { sha256Of } from "../storage/hash";
import { layoutOf } from "../storage/layout";
import { driverFor } from "../storage/registry";
import type { StorageDriver } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { loadBatch, saveBatch, type UploadBatch } from "../upload/batches";
import { recordTrashed } from "../repositories/trash.repo";
import { assertItemRoom } from "./item-limit.service";
import { createFolder } from "./node.service";
import { assertSpace, reserveSpace, type SpaceOwner } from "./space.service";
import { assertAccountWritable, driverForAccount, lockAccountForWrite } from "./volume.service";
import { enqueueMedia } from "../jobs/queue";
import { countOne } from "../metrics/counters";
import { lockedLocationOf } from "./node-location";
import { logger } from "../logger";

type Owner = SpaceOwner;

const BATCH_ID_LENGTH = 24;
/** A name no upload can have (names are validated), held by a replaced row until it is deleted. */
const replacedName = (nodeId: string) => `replaced/${nodeId}`;
/** Folder depth of the folder a Home upload creates: the account root, then the upload folder. */
const HOME_UPLOAD_DEPTH = 2;

/** Files plus the folders their paths create, at most (existing folders are reused). */
const newItemCount = (rels: readonly string[]) => rels.length + folderCount(rels);


/** Rejects a path with an invalid segment, naming the first problem (design wording). */
export function checkRelPath(rel: string): void {
  for (const segment of rel.split("/")) {
    const error = nameError(segment);
    if (error) throw new ApiError("BAD_REQUEST", error, { fields: { files: error } });
  }
}

/** The volume a tus request (`/api/uploads/tus/<volumeId>/…`) writes to; null when it is unknown or offline. */
export async function tusVolume(volumeId: string | undefined) {
  const volume = volumeId ? await findVolume(db(), volumeId) : null;
  return volume && volume.status !== "OFFLINE" ? volume : null;
}

/**
 * Plans an upload: validates names, reports duplicates for the
 * dialog, checks quota and disk space, creates the Home upload folder, and stores the batch
 * the tus server will accept files for.
 */
export async function prepareUpload(owner: Owner, input: PrepareUploadInput): Promise<PrepareUploadResult> {
  input.files.forEach((file) => checkRelPath(file.rel));
  await assertAccountWritable(owner.id);
  const volume = await findVolume(db(), owner.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const driver = driverFor(volume);
  const space = { id: volume.id, reservePct: volume.reservePct, driver };

  let files = input.files.map((file, index) => ({ ...file, index }));
  let folder: Pick<NodeRow, "id" | "name">;
  const fromHome = input.target === "home";

  if (fromHome) {
    const plan = homeUploadPlan(
      files.map((file) => file.rel),
      input.fallbackName && !nameError(input.fallbackName) ? input.fallbackName : uploadFallbackName(new Date()),
    );
    files = files.map((file, position) => ({ ...file, rel: plan.rels[position]! }));
    // The root, the new upload folder, then each file's folders.
    if (files.some((file) => HOME_UPLOAD_DEPTH + file.rel.split("/").length > STORAGE.maxFolderDepth)) throw new ApiError("BAD_REQUEST", "Folders are nested too deeply.");
    await assertItemRoom(owner, newItemCount(files.map((file) => file.rel)) + 1);
    await assertSpace(owner, files.reduce((sum, file) => sum + file.size, 0), space);
    folder = (await createFolder(owner, "root", plan.name)).folder;
  } else {
    const target = input.target === "root" ? await findRootFolder(db(), owner.id) : await findNode(db(), owner.id, input.target);
    if (!target || target.type !== "FOLDER") throw new ApiError("NOT_FOUND");
    const depth = (await ancestorChain(db(), target.id)).length;
    if (files.some((file) => depth + file.rel.split("/").length > STORAGE.maxFolderDepth)) throw new ApiError("BAD_REQUEST", "Folders are nested too deeply.");
    const existing = await relativePaths(db(), target.id);
    const isDuplicate = (rel: string) => existing.get(rel)?.type === "FILE";
    const duplicates = files.filter((file) => isDuplicate(file.rel));
    if (duplicates.length > 0 && !input.dup) return { kind: "duplicates", names: duplicates.map((file) => file.rel) };
    if (input.dup === "skip") files = files.filter((file) => !isDuplicate(file.rel));
    if (files.length === 0) return { kind: "nothing" };
    await assertItemRoom(owner, newItemCount(files.map((file) => file.rel)));
    await assertSpace(owner, files.reduce((sum, file) => sum + file.size, 0), space);
    folder = target;
  }

  const batchId = randomString(BATCH_ID_LENGTH, ID_ALPHABET);
  const batch: UploadBatch = { accountId: owner.id, volumeId: volume.id, folderId: folder.id, fromHome, dup: input.dup ?? "keep", files: files.map(({ rel, size }) => ({ rel, size })) };
  await saveBatch(batchId, batch);
  return {
    kind: "ready",
    batchId,
    endpoint: `/api/uploads/tus/${volume.id}`,
    folder: { id: folder.id, name: folder.name },
    files: files.map((file) => ({ index: file.index, rel: file.rel, size: file.size })),
  };
}

/** Validates a new tus upload against its batch and reserves its space; returns the batch entry. */
export async function checkUploadStart(owner: Owner, batchId: string, slot: number, size: number | undefined, volumeId: string, uploadId: string): Promise<{ batch: UploadBatch; rel: string }> {
  const batch = await loadBatch(batchId);
  const entry = batch?.files[slot];
  if (!batch || !entry || batch.accountId !== owner.id || batch.volumeId !== volumeId) throw new ApiError("NOT_FOUND", "This upload has expired. Start it again.");
  // The size must be known now (no tus Upload-Defer-Length): quota and free space are checked
  // against it, and tus then refuses any byte past it.
  if (size !== entry.size) throw new ApiError("BAD_REQUEST", "The file changed since the upload started.");
  await assertAccountWritable(owner.id);
  const volume = await findVolume(db(), batch.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  await reserveSpace(owner, uploadId, entry.size, { id: volume.id, reservePct: volume.reservePct, driver: driverFor(volume) });
  return { batch, rel: entry.rel };
}

/** Finds or creates the folder chain below the upload folder (folder uploads keep their structure). */
async function ensureFolders(owner: Owner, driver: StorageDriver, baseId: string, dirs: string[]): Promise<{ id: string; segments: string[] }> {
  const base = await ancestorChain(db(), baseId);
  let parentId = baseId;
  const segments = segmentsBelowRoot(base);
  for (const dir of dirs) {
    // A parallel upload may create the same folder first: the next try finds and uses it.
    const folder = await retryOnUniqueViolation(async () => {
      const existing = await findChildByName(db(), parentId, dir);
      if (existing?.type === "FOLDER") return { id: existing.id, name: dir };
      // A file already has this name: put the folder next to it as "Name (2)".
      const name = existing ? uniqName(await listSiblingNames(db(), parentId), dir, false) : dir;
      const created = await withStorageTransaction(db(), async (tx, undo) => {
        // Waits for and blocks a move of the account to another volume (docs/architecture.md "쓰기 잠금").
        await lockAccountForWrite(tx, owner.id, driver.volumeId);
        const row = await createFolderNode(tx, { id: newNodeId(), accountId: owner.id, parentId, name, linkId: newLinkId() });
        const location = { accountId: owner.id, segments: [...segments, name] };
        await driver.createFolder(location);
        undo.push("remove upload folder", async () => {
          await driver.moveToTrash(location);
        });
        return row;
      });
      return { id: created.id, name };
    });
    parentId = folder.id;
    segments.push(folder.name);
  }
  return { id: parentId, segments };
}

/**
 * Moves a finished upload into place and records it: content-detected type, SHA-256, the
 * file's own modification time (the upload time when the sender gave none) and the batch's
 * duplicate policy (replace, keep both as "name (2)", or skip).
 */
export async function finalizeUpload(owner: Owner, batch: UploadBatch, slot: number, uploadId: string, modifiedAt: Date | null = null): Promise<UploadedFile> {
  const entry = batch.files[slot];
  if (!entry) throw new ApiError("NOT_FOUND");
  const volume = await findVolume(db(), batch.volumeId);
  // Without its volume the received bytes cannot be reached (nor removed) from here.
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const tempPath = `${layoutOf(volume.mountPath).uploads}/${uploadId}`;
  try {
    const driver = await driverForAccount(owner, "write");
    // The recorded size counts toward the quota, so it must be the size of the bytes received.
    if ((await stat(tempPath)).size !== entry.size) throw new ApiError("BAD_REQUEST", "The file changed since the upload started.");
    return await placeUpload(owner, driver, batch, entry, tempPath, modifiedAt ?? new Date());
  } catch (error) {
    // Any refusal (volume busy or offline, its folder deleted meanwhile, a name clash) removes
    // the received bytes. Left in place they would sit in the temp area where no quota sees
    // them, and a retry would find the upload complete (offset = length) and stop without
    // this step ever running again; removed, the retry gets 404 and starts a new upload.
    await rm(tempPath, { force: true });
    await rm(`${tempPath}.json`, { force: true });
    throw error;
  }
}

/** Puts a received upload into its folder and records it (the second half of {@link finalizeUpload}). */
async function placeUpload(owner: Owner, driver: StorageDriver, batch: UploadBatch, entry: UploadBatch["files"][number], tempPath: string, modifiedAt: Date): Promise<UploadedFile> {
  const parts = entry.rel.split("/");
  const fileName = parts.at(-1)!;
  // The account's own folder never moves, so it may be (re)created; folders below it must exist.
  await driver.ensureUserRoot(owner.id);
  const folder = await ensureFolders(owner, driver, batch.folderId, parts.slice(0, -1));

  const detected = await fileTypeFromFile(tempPath).catch(() => undefined);
  const mime = detected?.mime ?? mimeFromName(fileName);
  const sha256 = await sha256Of(createReadStream(tempPath));
  const existing = await findChildByName(db(), folder.id, fileName);
  const replace = batch.dup === "replace" && existing?.type === "FILE" ? existing : null;
  const name = existing && !replace ? uniqName(await listSiblingNames(db(), folder.id), fileName, true) : fileName;
  const location = { accountId: owner.id, segments: [...folder.segments, name] };
  // The same bytes already in the account: link to them instead of keeping a second copy.
  const twin = await findFileWithContent(db(), owner.id, sha256, BigInt(entry.size), replace?.id ?? null);
  let linked = false;

  const row = await withStorageTransaction(db(), async (tx, undo) => {
    await lockAccountForWrite(tx, owner.id, driver.volumeId);
    if (replace) {
      const trashed = await driver.moveToTrash(location);
      undo.push("restore replaced file", () => driver.restoreFromTrash(trashed, location));
      await recordTrashed(tx, owner.id, replace.size);
      // The old row steps aside (its name and link are taken by the replacement below).
      await updateNode(tx, replace.id, { name: replacedName(replace.id), linkId: newLinkId() });
    }
    // New content gets a new id (cached bytes are keyed by it, docs/architecture.md), but a
    // replaced file hands over its share link, the link's settings, tags and history, so
    // links already sent keep working.
    const placed = await createFileNode(tx, {
      id: newNodeId(),
      accountId: owner.id,
      parentId: folder.id,
      name,
      kind: kindFromMime(mime).toUpperCase() as "VIDEO" | "AUDIO" | "IMAGE" | "OTHER",
      mime,
      size: BigInt(entry.size),
      sha256,
      modifiedAt,
      ...(replace ? carriedSettingsOf(replace) : { linkId: newLinkId() }),
    });
    if (replace) {
      await moveLinkEvents(tx, replace.id, placed.id);
      await deleteNodes(tx, [replace.id]);
    }
    // The twin's path is read with it and its folders locked, so a rename or move meanwhile
    // cannot leave the link pointing at another file of the same size.
    const twinLocation = twin ? await lockedLocationOf(tx, owner.id, twin.id) : null;
    linked = twinLocation !== null && (await driver.linkExisting(twinLocation, location, entry.size));
    if (!linked) await driver.moveIntoPlace(tempPath, location);
    undo.push("remove placed file", async () => {
      await driver.moveToTrash(location);
    });
    return placed;
  });
  // tus keeps upload state next to the data file; the data moved (or was linked), so drop the state too.
  await unlink(`${tempPath}.json`).catch(() => undefined);
  if (linked) {
    await driver.discardStaged(tempPath);
    void countOne("deduplicated_files");
  }
  if (replace) await driver.removeAssets(owner.id, [replace.id]).catch((error: unknown) => logger.warn("old media assets not removed", { error }));
  if (row.kind === "IMAGE" || row.kind === "VIDEO") void enqueueMedia([row.id]);
  return { nodeId: row.id, name: row.name, folderId: folder.id };
}
