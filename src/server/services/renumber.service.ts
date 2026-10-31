import "server-only";
import { randomBytes } from "node:crypto";
import { RENUMBER } from "@/config/policy";
import type { RenumberPreview, RenumberResult } from "@/contracts/nodes";
import { planRenumber, renumberChanges, renumberTempName, samePlan, type RenumberCandidate, type RenumberEntry, type RenumberOrder, type RenumberPlan, type RenumberSort } from "@/domain/renumber";
import { db, type DbClient } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { listChildrenForRenumber, lockFolderForRenumber, updateNode } from "../repositories/node.repo";
import { StorageTargetExistsError, type StorageDriver, type StorageLocation } from "../storage/driver";
import { withStorageTransaction, type UndoStack } from "../storage/storage-transaction";
import { locationOf } from "./node-location";
import { requireFolder, type NodeOwner } from "./node-ops.service";
import { driverForAccount } from "./volume.service";

/** Random part of the temporary names of one run (hex). */
const TEMP_TOKEN_BYTES = 6;
const CHANGED_MESSAGE = "This folder changed. Review the new order.";
const tooMany = (count: number) => `This folder has ${count.toLocaleString("en-US")} files. Renumber at most ${RENUMBER.maxFiles.toLocaleString("en-US")} at a time.`;

async function planFor(tx: DbClient, folderId: string, sort: RenumberSort, order: RenumberOrder): Promise<{ plan: RenumberPlan; names: Set<string> }> {
  const children = await listChildrenForRenumber(tx, folderId);
  const candidates: RenumberCandidate[] = children.map((child) => ({
    id: child.id,
    name: child.name,
    type: child.type === "FOLDER" ? "folder" : "file",
    createdAt: child.createdAt.getTime(),
    modifiedAt: child.modifiedAt?.getTime() ?? null,
    missing: child.missing,
  }));
  return { plan: planRenumber(candidates, sort, order), names: new Set(children.map((child) => child.name)) };
}

/** How the files directly inside a folder would be renamed (nothing changes). */
export async function previewRenumber(owner: NodeOwner, folderRef: string, sort: RenumberSort, order: RenumberOrder): Promise<RenumberPreview> {
  const folder = await requireFolder(owner.id, folderRef);
  const { plan } = await planFor(db(), folder.id, sort, order);
  const changes = renumberChanges(plan).length;
  const conflict = plan.conflict ?? (changes > RENUMBER.maxFiles ? tooMany(plan.entries.length) : null);
  return { entries: plan.entries, skipped: plan.skipped, changes, conflict };
}

/**
 * Renames one step's files in the DB and on disk, registering how to undo each. The disk rename
 * never replaces an existing file, so a name taken meanwhile stops the run instead of losing bytes.
 */
async function renameStep(tx: DbClient, driver: StorageDriver, undo: UndoStack, at: (name: string) => StorageLocation, steps: { id: string; from: string; to: string }[]): Promise<void> {
  for (const step of steps) {
    await updateNode(tx, step.id, { name: step.to });
    await driver.renameNoReplace(at(step.from), at(step.to));
    undo.push("undo renumber rename", () => driver.renameNoReplace(at(step.to), at(step.from)));
  }
}

/**
 * Runs the plan the user reviewed (`expect`), like scripts/sortNumbered.sh but inside one storage
 * transaction: every changed file first gets a hidden temporary name, then its number, so two
 * files can swap names. Node ids stay the same, so tags, share links, settings, link activity and
 * thumbnails are untouched. Any failure rolls the DB back and renames every file back on disk.
 */
export async function applyRenumber(owner: NodeOwner, folderRef: string, input: { sort: RenumberSort; order: RenumberOrder; expect: Pick<RenumberEntry, "id" | "to">[] }): Promise<RenumberResult> {
  const folder = await requireFolder(owner.id, folderRef);
  const driver = await driverForAccount(owner, "write");
  const base = await locationOf(owner.id, folder.id);
  const at = (name: string): StorageLocation => ({ accountId: owner.id, segments: [...base.segments, name] });

  try {
    return await withStorageTransaction(db(), async (tx, undo) => {
      // Plans again after the lock: a second run waits here and sees the names the first one left.
      await lockFolderForRenumber(tx, folder.id);
      const { plan, names } = await planFor(tx, folder.id, input.sort, input.order);
      if (plan.conflict) throw new ApiError("CONFLICT", plan.conflict);
      if (!samePlan(input.expect, plan.entries)) throw new ApiError("CONFLICT", CHANGED_MESSAGE);
      const changes = renumberChanges(plan);
      if (changes.length > RENUMBER.maxFiles) throw new ApiError("BAD_REQUEST", tooMany(plan.entries.length));
      if (changes.length === 0) return { renamed: 0, unchanged: plan.entries.length };

      const token = randomBytes(TEMP_TOKEN_BYTES).toString("hex");
      const temps = changes.map((_, index) => renumberTempName(token, index));
      if (temps.some((temp) => names.has(temp))) throw new ApiError("CONFLICT", CHANGED_MESSAGE);
      await renameStep(tx, driver, undo, at, changes.map((change, index) => ({ id: change.id, from: change.from, to: temps[index]! })));
      await renameStep(tx, driver, undo, at, changes.map((change, index) => ({ id: change.id, from: temps[index]!, to: change.to })));
      return { renamed: changes.length, unchanged: plan.entries.length - changes.length };
    });
  } catch (caught) {
    if (caught instanceof StorageTargetExistsError || isUniqueViolation(caught)) throw new ApiError("CONFLICT", `${CHANGED_MESSAGE} Nothing was renamed.`);
    throw caught;
  }
}
