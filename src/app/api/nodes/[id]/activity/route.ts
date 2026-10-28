import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { linkActivity } from "@/server/services/node-ops.service";

/** Share link activity of an item (newest first). */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  return linkActivity(account, nodeIdSchema.parse(params.id));
});
