import { deleteSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { deleteItems } from "@/server/services/node-ops.service";

/** Deletes items with everything inside. */
export const POST = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  const { ids } = deleteSchema.parse(await req.json());
  return deleteItems(account, ids);
});
