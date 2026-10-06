import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { STORAGE } from "@/config/policy";
import type { PrepareUploadInput, PrepareUploadResult, UploadedFile } from "@/contracts/uploads";
import { formatSize } from "@/domain/format";
import { randomString, ID_ALPHABET, newLinkId, newNodeId } from "@/domain/ids";
import { nameError, uniqName } from "@/domain/names";
import { homeUploadPlan, kindFromMime, mimeFromName, uploadFallbackName } from "@/domain/upload";
import { db, Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import type { AccountRow } from "../repositories/account.repo";
import {
  accountUsage,
  ancestorChain,
  createFileNode,
  createFolderNode,
  deleteNodes,
  findChildByName,
  findNode,
  findRootFolder,
  listSiblingNames,
  relativePaths,
  type NodeRow,
} from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import { layoutOf } from "../storage/layout";
import { availableAboveReserve, driverFor } from "../storage/registry";
import type { StorageDriver } from "../storage/driver";
import { withStorageTransaction } from "../storage/storage-transaction";
import { loadBatch, saveBatch, type UploadBatch } from "../upload/batches";
import { createFolder } from "./node.service";
import { driverForAccount } from "./volume.service";
import { enqueueMedia } from "../jobs/queue";

type Owner = Pick<AccountRow, "id" | "volumeId" | "quotaBytes">;

const BATCH_ID_LENGTH = 24;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Rejects a path with an invalid segment, naming the first problem (design wording). */
function checkRelPath(rel: string): void {
  for (const segment of rel.split("/")) {
    const error = nameError(segment);
    if (error) throw new ApiError("BAD_REQUEST", error, { fields: { files: error } });
  }
}

/** Bytes still allowed by the account quota and the volume's free space. */
async function assertSpace(owner: Owner, bytes: number, driver: StorageDriver, reservePct: number): Promise<void> {
  if (owner.quotaBytes !== null) {
    const { usedBytes } = await accountUsage(db(), owner.id);
    if (usedBytes + BigInt(bytes) > owner.quotaBytes) {
      const left = owner.quotaBytes > usedBytes ? owner.quotaBytes - usedBytes : 0n;
      throw new ApiError("INSUFFICIENT_STORAGE", `Not enough space: ${formatSize(Number(left))} left of ${formatSize(Number(owner.quotaBytes))}`);
    }
  }
  const space = await driver.space();
  if (availableAboveReserve(space.total, space.available, reservePct) < BigInt(bytes)) throw new ApiError("INSUFFICIENT_STORAGE");
}

/**
 * Plans an upload (design `startUpload`): validates names, reports duplicates for the
 * dialog, checks quota and disk space, creates the Home upload folder, and stores the batch
 * the tus server will accept files for.
 */
export async function prepareUpload(owner: Owner, input: PrepareUploadInput): Promise<PrepareUploadResult> {
  input.files.forEach((file) => checkRelPath(file.rel));
  const volume = await findVolume(db(), owner.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const driver = driverFor(volume);
  const reservePct = volume.reservePct;

  let files = input.files.map((file, index) => ({ ...file, index }));
  let folder: Pick<NodeRow, "id" | "name">;
  const fromHome = input.target === "home";

  if (fromHome) {
    const plan = homeUploadPlan(
      files.map((file) => file.rel),
      input.fallbackName && !nameError(input.fallbackName) ? input.fallbackName : uploadFallbackName(new Date()),
    );
    files = files.map((file, position) => ({ ...file, rel: plan.rels[position]! }));
    await assertSpace(owner, files.reduce((sum, file) => sum + file.size, 0), driver, reservePct);
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
    await assertSpace(owner, files.reduce((sum, file) => sum + file.size, 0), driver, reservePct);
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

/** Validates a new tus upload against its batch; returns the batch entry. */
export async function checkUploadStart(owner: Owner, batchId: string, slot: number, size: number | undefined): Promise<{ batch: UploadBatch; rel: string }> {
  const batch = await loadBatch(batchId);
  const entry = batch?.files[slot];
  if (!batch || !entry || batch.accountId !== owner.id) throw new ApiError("NOT_FOUND", "This upload has expired. Start it again.");
  if (size !== undefined && size !== entry.size) throw new ApiError("BAD_REQUEST", "The file changed since the upload started.");
  const volume = await findVolume(db(), batch.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  await assertSpace(owner, entry.size, driverFor(volume), volume.reservePct);
  return { batch, rel: entry.rel };
}

/** Finds or creates the folder chain below the upload folder (folder uploads keep their structure). */
async function ensureFolders(owner: Owner, driver: StorageDriver, baseId: string, dirs: string[]): Promise<{ id: string; segments: string[] }> {
  const base = await ancestorChain(db(), baseId);
  let parentId = baseId;
  const segments = base.slice(1).map((row) => row.name);
  for (const dir of dirs) {
    for (let attempt = 0; ; attempt++) {
      const existing = await findChildByName(db(), parentId, dir);
      if (existing?.type === "FOLDER") {
        parentId = existing.id;
        segments.push(dir);
        break;
      }
      // A file already has this name: put the folder next to it as "Name (2)".
      const name = existing ? uniqName(await listSiblingNames(db(), parentId), dir, false) : dir;
      try {
        const created = await withStorageTransaction(db(), async (tx, undo) => {
          const row = await createFolderNode(tx, { id: newNodeId(), accountId: owner.id, parentId, name, linkId: newLinkId() });
          const location = { accountId: owner.id, segments: [...segments, name] };
          await driver.createFolder(location);
          undo.push("remove upload folder", async () => {
            await driver.moveToTrash(location);
          });
          return row;
        });
        parentId = created.id;
        segments.push(name);
        break;
      } catch (error) {
        // A parallel upload created the same folder: use it.
        if (isUniqueViolation(error) && attempt < 2) continue;
        throw error;
      }
    }
  }
  return { id: parentId, segments };
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Moves a finished upload into place and records it: content-detected type, SHA-256,
 * and the batch's duplicate policy (replace, keep both as "name (2)", or skip).
 */
export async function finalizeUpload(owner: Owner, batch: UploadBatch, slot: number, uploadId: string): Promise<UploadedFile> {
  const entry = batch.files[slot];
  if (!entry) throw new ApiError("NOT_FOUND");
  const rel = entry.rel;
  const driver = await driverForAccount(owner);
  const volume = await findVolume(db(), batch.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const tempPath = `${layoutOf(volume.mountPath).uploads}/${uploadId}`;
  const parts = rel.split("/");
  const fileName = parts.at(-1)!;
  const folder = await ensureFolders(owner, driver, batch.folderId, parts.slice(0, -1));

  const detected = await fileTypeFromFile(tempPath).catch(() => undefined);
  const mime = detected?.mime ?? mimeFromName(fileName);
  const sha256 = await sha256Of(tempPath);
  const existing = await findChildByName(db(), folder.id, fileName);
  const replace = batch.dup === "replace" && existing?.type === "FILE" ? existing : null;
  const name = existing && !replace ? uniqName(await listSiblingNames(db(), folder.id), fileName, true) : fileName;
  const location = { accountId: owner.id, segments: [...folder.segments, name] };

  const row = await withStorageTransaction(db(), async (tx, undo) => {
    if (replace) {
      await deleteNodes(tx, [replace.id]);
      const trashed = await driver.moveToTrash(location);
      undo.push("restore replaced file", () => driver.restoreFromTrash(trashed, location));
    }
    const created = await createFileNode(tx, {
      id: newNodeId(),
      accountId: owner.id,
      parentId: folder.id,
      name,
      kind: kindFromMime(mime).toUpperCase() as "VIDEO" | "AUDIO" | "IMAGE" | "OTHER",
      mime,
      size: BigInt(entry.size),
      sha256,
      linkId: newLinkId(),
    });
    await driver.moveIntoPlace(tempPath, location);
    undo.push("remove placed file", async () => {
      await driver.moveToTrash(location);
    });
    return created;
  });
  // tus keeps upload state next to the data file; the data moved, so drop the state too.
  await unlink(`${tempPath}.json`).catch(() => undefined);
  if (replace) await driver.removeAssets(owner.id, [replace.id]).catch(() => undefined);
  if (row.kind === "IMAGE" || row.kind === "VIDEO") void enqueueMedia([row.id]);
  return { nodeId: row.id, name: row.name, folderId: folder.id };
}
