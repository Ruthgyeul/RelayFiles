import type { FolderNode } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { folderTree } from "@/server/services/node.service";

/** Every folder of the active account, for the move/copy picker. */
export const GET = apiHandler<FolderNode[]>({ auth: "active" }, async ({ active: { account } }) => {
  return folderTree(account.id);
});
