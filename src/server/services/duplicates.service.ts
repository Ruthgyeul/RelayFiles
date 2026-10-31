import "server-only";
import { getEnv } from "@/config/env";
import { DUPLICATES } from "@/config/policy";
import type { DuplicateFile, DuplicatesResult, NodeItem } from "@/contracts/nodes";
import { groupDuplicates } from "@/domain/duplicates";
import { db } from "../db/client";
import { filesInFolders, findRootFolder } from "../repositories/node.repo";
import { folderPathsBelow } from "../repositories/node-tree.repo";
import { requireFolder, type NodeOwner } from "./node-ops.service";

/**
 * Files with the same content (SHA-256 and size) in a folder, or in its whole tree. Read only:
 * removing copies goes through the normal delete. With deduplication on, copies may already share
 * their bytes on disk, so deleting one frees quota but not always disk space.
 */
export async function findDuplicates(owner: NodeOwner, folderRef: string, recursive: boolean): Promise<DuplicatesResult> {
  const folder = await requireFolder(owner.id, folderRef);
  const rootId = folder.parentId === null ? folder.id : (await findRootFolder(db(), owner.id))?.id;
  const folders = recursive ? await folderPathsBelow(db(), folder.id) : [{ id: folder.id, path: "" }];
  const pathOf = new Map(folders.map((entry) => [entry.id, entry.path]));
  const maxScan = getEnv("policy").DUPLICATES_MAX_SCAN;
  const rows = await filesInFolders(db(), owner.id, [...pathOf.keys()], maxScan + 1);
  const scanned = rows.slice(0, maxScan);

  const { groups, unchecked } = groupDuplicates(
    scanned.map((row) => ({
      id: row.id,
      sha256: row.sha256,
      size: Number(row.size),
      createdAt: row.createdAt.getTime(),
      file: {
        id: row.id,
        name: row.name,
        folderPath: pathOf.get(row.parentId ?? "") ?? "",
        parentId: row.parentId ?? folder.id,
        parentIsRoot: row.parentId === rootId,
        kind: row.kind ? (row.kind.toLowerCase() as NodeItem["kind"]) : null,
        hasThumb: row.hasThumb,
        createdAt: row.createdAt.toISOString(),
        modifiedAt: row.modifiedAt?.toISOString() ?? null,
      } satisfies DuplicateFile,
    })),
  );
  return {
    groups: groups.slice(0, DUPLICATES.maxGroups).map((group) => ({
      sha256: group.sha256,
      size: String(group.size),
      wasted: String(group.wasted),
      files: group.files.map((entry) => entry.file),
    })),
    scanned: scanned.length,
    unchecked,
    truncated: rows.length > maxScan || groups.length > DUPLICATES.maxGroups,
  };
}
