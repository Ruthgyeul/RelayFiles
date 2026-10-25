import "server-only";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { UploadedFile } from "@/contracts/uploads";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import type { AccountRow } from "../repositories/account.repo";
import { findNode, findRootFolder, relativePaths } from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import { DIR_MODE, FILE_MODE, layoutOf } from "../storage/layout";
import { driverFor } from "../storage/registry";
import type { UploadBatch } from "../upload/batches";
import { assertSpace } from "./space.service";
import { checkRelPath, finalizeUpload } from "./upload.service";

type Owner = Pick<AccountRow, "id" | "volumeId" | "quotaBytes" | "isAdmin">;

export interface ImportTarget {
  owner: Owner;
  volumeId: string;
  rootId: string;
  /** Paths already in the account (relative to its root), read once when the import starts. */
  existing: Map<string, { id: string; type: "FILE" | "FOLDER" }>;
  ignoreQuota: boolean;
}

export type ImportResult = { status: "imported"; file: UploadedFile } | { status: "skipped" };

/** The account an import writes into, with the paths it already holds. */
export async function openImportTarget(owner: Owner, ignoreQuota: boolean): Promise<ImportTarget> {
  const root = await findRootFolder(db(), owner.id);
  if (!root) throw new ApiError("NOT_FOUND");
  return { owner, volumeId: owner.volumeId, rootId: root.id, existing: await relativePaths(db(), root.id), ignoreQuota };
}

/**
 * Copies one file into the account the way an upload does (npm run storage:import): into the
 * volume's upload area first, then finalizeUpload records it and moves it into place. A file
 * already at the same path with the same size is skipped, so an interrupted import can be
 * re-run; a different file with that name is kept next to it as "name (2)".
 */
export async function importFile(target: ImportTarget, rel: string, size: number, source: AsyncIterable<Uint8Array>): Promise<ImportResult> {
  checkRelPath(rel);
  const current = target.existing.get(rel);
  if (current?.type === "FILE" && (await findNode(db(), target.owner.id, current.id))?.size === BigInt(size)) {
    // Drain the entry so the tar stream moves on to the next one.
    for await (const chunk of source) void chunk;
    return { status: "skipped" };
  }

  const volume = await findVolume(db(), target.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  await assertSpace(target.owner, size, { id: volume.id, reservePct: volume.reservePct, driver: driverFor(volume) }, { quotas: !target.ignoreQuota });

  const uploads = layoutOf(volume.mountPath).uploads;
  await mkdir(uploads, { recursive: true, mode: DIR_MODE });
  const uploadId = `import-${randomUUID()}`;
  const tempPath = `${uploads}/${uploadId}`;
  try {
    await pipeline(source, createWriteStream(tempPath, { flags: "wx", mode: FILE_MODE }));
    if ((await stat(tempPath)).size !== size) throw new Error(`Short read for ${rel}`);
    const batch: UploadBatch = { accountId: target.owner.id, volumeId: volume.id, folderId: target.rootId, fromHome: false, dup: "keep", files: [{ rel, size }] };
    return { status: "imported", file: await finalizeUpload(target.owner, batch, 0, uploadId) };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
