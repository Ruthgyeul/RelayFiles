import "server-only";
import { FILES } from "@/config/policy";
import type { AccountRow } from "../repositories/account.repo";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { countItems } from "../repositories/node.repo";

/** Refuses `adding` new files and folders that would take a member account past FILES.maxItemsPerAccount. */
export async function assertItemRoom(owner: Pick<AccountRow, "id" | "isAdmin">, adding: number): Promise<void> {
  if (owner.isAdmin || adding <= 0) return;
  // The root folder is not one of the account's items.
  const items = (await countItems(db(), owner.id)) - 1;
  if (items + adding > FILES.maxItemsPerAccount) throw new ApiError("BAD_REQUEST", `An account can hold at most ${FILES.maxItemsPerAccount} files and folders.`);
}
