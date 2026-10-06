import "server-only";
import type { DbClient } from "../db/client";

/** Name of every account's root folder; it maps to users/<accountId>/ on the volume. */
export const ROOT_FOLDER_NAME = "root";

export async function createRootFolder(db: DbClient, data: { id: string; accountId: string; linkId: string }): Promise<void> {
  await db.node.create({ data: { ...data, parentId: null, type: "FOLDER", name: ROOT_FOLDER_NAME } });
}

/** Bytes stored by an account (sum of file sizes) and the number of items in its root folder. */
export async function accountUsage(db: DbClient, accountId: string): Promise<{ usedBytes: bigint; rootItems: number }> {
  const [sum, rootItems] = await Promise.all([
    db.node.aggregate({ where: { accountId, type: "FILE" }, _sum: { size: true } }),
    db.node.count({ where: { accountId, parent: { parentId: null, accountId } } }),
  ]);
  return { usedBytes: sum._sum.size ?? 0n, rootItems };
}
