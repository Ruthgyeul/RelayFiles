import type { FolderNode } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { folderTree } from "@/server/services/node.service";

/** Every folder of the active account, for the move/copy picker. */
export const GET = apiHandler<FolderNode[]>(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return folderTree(account.id);
});
