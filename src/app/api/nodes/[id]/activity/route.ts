import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { linkActivity } from "@/server/services/node-ops.service";

/** Share link activity of an item (newest first). */
export const GET = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return linkActivity(account, nodeIdSchema.parse(params.id));
});
