import { folderRefSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { getFolderView } from "@/server/services/node.service";

/** A folder of the active account ("root" or an id) with its path and children. */
export const GET = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return getFolderView(account.id, folderRefSchema.parse(params.id));
});
