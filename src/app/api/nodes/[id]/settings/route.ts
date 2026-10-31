import { nodeIdSchema, settingsSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { updateSettings } from "@/server/services/node-settings.service";

/** Saves the share settings of a file or folder. */
export const PUT = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  return updateSettings(account, nodeIdSchema.parse(params.id), settingsSchema.parse(await req.json()));
});
