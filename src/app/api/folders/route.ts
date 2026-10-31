import { createFolderSchema } from "@/contracts/nodes";
import { apiHandler, ok } from "@/server/http/api-handler";
import { createFolder } from "@/server/services/node.service";

/** Creates a folder; a taken name becomes "Name (2)" and the response says so. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { parentId, name } = createFolderSchema.parse(await req.json());
  return ok(await createFolder(account, parentId, name), { status: 201 });
});
