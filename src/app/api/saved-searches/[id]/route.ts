import { savedSearchIdSchema } from "@/contracts/saved-searches";
import { apiHandler } from "@/server/http/api-handler";
import { removeSavedSearch } from "@/server/services/saved-search.service";

export const DELETE = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  await removeSavedSearch(account.id, savedSearchIdSchema.parse(params.id));
  return { deleted: true };
});
