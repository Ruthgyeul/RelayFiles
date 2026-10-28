import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { regenerateLink } from "@/server/services/node-settings.service";

/** Replaces the share link of an item; the old link stops working. */
export const POST = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  return regenerateLink(account, nodeIdSchema.parse(params.id));
});
