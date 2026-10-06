import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { regenerateLink } from "@/server/services/node-ops.service";

/** Replaces the share link of an item; the old link stops working. */
export const POST = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return regenerateLink(account, nodeIdSchema.parse(params.id));
});
