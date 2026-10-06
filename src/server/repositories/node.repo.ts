import "server-only";
import type { DbClient } from "../db/client";

/** Name of every account's root folder; it maps to users/<accountId>/ on the volume. */
export const ROOT_FOLDER_NAME = "root";

export async function createRootFolder(db: DbClient, data: { id: string; accountId: string; linkId: string }): Promise<void> {
  await db.node.create({ data: { ...data, parentId: null, type: "FOLDER", name: ROOT_FOLDER_NAME } });
}
