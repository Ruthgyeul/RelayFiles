import { createFolderSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler, ok } from "@/server/http/api-handler";
import { createFolder } from "@/server/services/node.service";

/** Creates a folder; a taken name becomes "Name (2)" and the response says so. */
export const POST = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  const { parentId, name } = createFolderSchema.parse(await req.json());
  return ok(await createFolder(account, parentId, name), { status: 201 });
});
