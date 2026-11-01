import { deletedItemIdSchema, type RestoredItem } from "@/contracts/trash";
import { apiHandler } from "@/server/http/api-handler";
import { restoreDeletedItem } from "@/server/services/trash.service";

/** Puts a deleted item back into its old folder (or the account root when that is gone). */
export const POST = apiHandler<RestoredItem, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  return restoreDeletedItem(account, deletedItemIdSchema.parse(params.id));
});
