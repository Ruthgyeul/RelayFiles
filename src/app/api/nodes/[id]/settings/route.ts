import { nodeIdSchema, settingsSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { updateSettings } from "@/server/services/node-ops.service";

/** Saves the share settings of a file or folder. */
export const PUT = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return updateSettings(account, nodeIdSchema.parse(params.id), settingsSchema.parse(await req.json()));
});
