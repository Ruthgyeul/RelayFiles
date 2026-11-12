import "server-only";
import { randomBytes } from "node:crypto";
import { renumberTempName } from "@/domain/renumber";
import type { DbClient } from "../db/client";
import { ApiError } from "../http/api-error";
import { renameChildren } from "../repositories/node.repo";
import type { StorageDriver, StorageLocation } from "../storage/driver";
import type { UndoStack } from "../storage/storage-transaction";

/** Random part of the temporary names of one run (hex). */
const TEMP_TOKEN_BYTES = 6;

/** One item of a folder and the name it gets. */
export interface ChildRename {
  id: string;
  from: string;
  to: string;
}

/**
 * Renames one step's items: the DB rows in one statement, then each item on disk with its undo.
 * The disk rename never replaces an existing entry, so a name taken meanwhile stops the run
 * instead of losing bytes.
 */
async function renameStep(
  tx: DbClient,
  folderId: string,
  driver: StorageDriver,
  undo: UndoStack,
  at: (name: string) => StorageLocation,
  steps: readonly ChildRename[],
  changed: string,
): Promise<void> {
  const renamed = await renameChildren(
    tx,
    folderId,
    steps.map((step) => ({ id: step.id, name: step.to })),
  );
  if (renamed !== steps.length) throw new ApiError("CONFLICT", changed);
  for (const step of steps) {
    await driver.renameNoReplace(at(step.from), at(step.to));
    undo.push("undo folder rename", () => driver.renameNoReplace(at(step.to), at(step.from)));
  }
}

/**
 * Renames items of one folder inside a storage transaction: each one first gets a hidden
 * temporary name, then its new name, so items can swap names. `names` are every name in the
 * folder now (a temporary name must not be one of them); `changed` is the conflict message.
 * Node ids stay the same, so tags, share links, settings and thumbnails are untouched.
 */
export async function renameInFolder(
  tx: DbClient,
  folderId: string,
  driver: StorageDriver,
  undo: UndoStack,
  at: (name: string) => StorageLocation,
  changes: readonly ChildRename[],
  names: ReadonlySet<string>,
  changed: string,
): Promise<void> {
  if (changes.length === 0) return;
  const token = randomBytes(TEMP_TOKEN_BYTES).toString("hex");
  const temps = changes.map((_, index) => renumberTempName(token, index));
  if (temps.some((temp) => names.has(temp))) throw new ApiError("CONFLICT", changed);
  await renameStep(
    tx,
    folderId,
    driver,
    undo,
    at,
    changes.map((change, index) => ({ id: change.id, from: change.from, to: temps[index]! })),
    changed,
  );
  await renameStep(
    tx,
    folderId,
    driver,
    undo,
    at,
    changes.map((change, index) => ({ id: change.id, from: temps[index]!, to: change.to })),
    changed,
  );
}
