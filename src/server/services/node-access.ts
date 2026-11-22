import "server-only";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import type { AccountRow } from "../repositories/account.repo";
import { findNode, findRootFolder, type NodeRow } from "../repositories/node.repo";

/** The account an item operation acts for (its own items only), with what space checks need. */
export type NodeOwner = Pick<AccountRow, "id" | "volumeId" | "isAdmin" | "quotaBytes">;

/** One of the account's items; another account's item is 404 like a missing one. */
export async function requireNode(accountId: string, nodeId: string): Promise<NodeRow> {
  const row = await findNode(db(), accountId, nodeId);
  if (!row) throw new ApiError("NOT_FOUND");
  return row;
}

/** "root" or one of the account's folders; anything else (a file, another account's folder) is 404. */
export async function requireFolder(accountId: string, ref: string): Promise<NodeRow> {
  const row = ref === "root" ? await findRootFolder(db(), accountId) : await findNode(db(), accountId, ref);
  if (!row || row.type !== "FOLDER") throw new ApiError("NOT_FOUND");
  return row;
}
