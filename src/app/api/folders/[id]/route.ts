import { folderRefSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { getFolderView } from "@/server/services/node.service";

/** A folder of the active account ("root" or an id) with its path and children. */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  return getFolderView(account.id, folderRefSchema.parse(params.id));
});
