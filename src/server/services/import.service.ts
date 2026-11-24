import "server-only";
import { publishAccountChange } from "../events/account-events";
import { randomUUID } from "node:crypto";
import type { UploadedFile } from "@/contracts/uploads";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { findNode, findRootFolder } from "../repositories/node.repo";
import { relativePaths } from "../repositories/node-tree.repo";
import { findVolume } from "../repositories/volume.repo";
import type { UploadBatch } from "../upload/batches";
import { assertSpace, spaceOf } from "./space.service";
import { checkRelPath, finalizeUpload } from "./upload.service";
import type { NodeOwner } from "./node-access";


export interface ImportTarget {
  owner: NodeOwner;
  volumeId: string;
  rootId: string;
  /** Paths already in the account (relative to its root), read once when the import starts. */
  existing: Map<string, { id: string; type: "FILE" | "FOLDER" }>;
  ignoreQuota: boolean;
}

export type ImportResult = { status: "imported"; file: UploadedFile } | { status: "skipped" };

/** The account an import writes into, with the paths it already holds. */
export async function openImportTarget(owner: NodeOwner, ignoreQuota: boolean): Promise<ImportTarget> {
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
export async function importFile(target: ImportTarget, rel: string, size: number, source: AsyncIterable<Uint8Array>, modifiedAt: Date | null = null): Promise<ImportResult> {
  checkRelPath(rel);
  const current = target.existing.get(rel);
  if (current?.type === "FILE" && (await findNode(db(), target.owner.id, current.id))?.size === BigInt(size)) {
    // Drain the entry so the tar stream moves on to the next one.
    for await (const chunk of source) void chunk;
    return { status: "skipped" };
  }

  const volume = await findVolume(db(), target.volumeId);
  if (!volume) throw new ApiError("STORAGE_OFFLINE");
  const space = spaceOf(volume);
  await assertSpace(target.owner, size, space, { quotas: !target.ignoreQuota });

  const uploadId = `import-${randomUUID()}`;
  try {
    await space.driver.stageUpload(uploadId, source);
    if ((await space.driver.stagedUploadSize(uploadId)) !== size) throw new Error(`Short read for ${rel}`);
    const batch: UploadBatch = { accountId: target.owner.id, volumeId: volume.id, folderId: target.rootId, fromHome: false, dup: "keep", files: [{ rel, size }] };
    const file = await finalizeUpload(target.owner, batch, 0, uploadId, modifiedAt);
    // Open pages of the account follow the import (one event per second at most per page).
    publishAccountChange(target.owner.id);
    return { status: "imported", file };
  } catch (error) {
    await space.driver.discardUpload(uploadId);
    throw error;
  }
}
