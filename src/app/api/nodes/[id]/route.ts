import { nodeIdSchema, renameSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { renameNode } from "@/server/services/node-ops.service";
import { getProperties } from "@/server/services/node.service";

/** Properties of one file or folder of the active account. */
export const GET = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return getProperties(account.id, nodeIdSchema.parse(params.id));
});

/** Renames a file or folder (also on disk). */
export const PATCH = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  const { name } = renameSchema.parse(await req.json());
  return renameNode(account, nodeIdSchema.parse(params.id), name);
});
