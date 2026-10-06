import { tagsSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { updateTags } from "@/server/services/node-ops.service";

/** Adds and removes tags on one or many items. */
export const POST = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  const { ids, add, remove } = tagsSchema.parse(await req.json());
  return updateTags(account, ids, add, remove);
});
