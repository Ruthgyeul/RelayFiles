import { makePrivateSchema } from "@/contracts/shares";
import { apiHandler } from "@/server/http/api-handler";
import { makeItemsPrivate } from "@/server/services/shared-items.service";

/** Makes several items private at once ("Shared by me"). */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { ids } = makePrivateSchema.parse(await req.json());
  return makeItemsPrivate(account.id, ids);
});
