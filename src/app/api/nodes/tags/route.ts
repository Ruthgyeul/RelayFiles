import { tagsSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { updateTags } from "@/server/services/node-ops.service";

/** Adds and removes tags on one or many items. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { ids, add, remove } = tagsSchema.parse(await req.json());
  return updateTags(account, ids, add, remove);
});
