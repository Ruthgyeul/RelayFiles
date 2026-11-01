import { deletedItemIdSchema } from "@/contracts/trash";
import { apiHandler } from "@/server/http/api-handler";
import { deleteForever } from "@/server/services/trash.service";

/** "Delete forever": removes a deleted item from the trash now instead of with the daily cleanup. */
export const DELETE = apiHandler<{ deleted: true }, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  await deleteForever(account, deletedItemIdSchema.parse(params.id));
  return { deleted: true };
});
