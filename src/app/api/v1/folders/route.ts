import { createFolderSchema } from "@/contracts/nodes";
import { ok } from "@/server/http/api-handler";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { createFolder } from "@/server/services/node.service";

/** Creates a folder `{ parentId: "root" | id, name }`; a taken name becomes "Name (2)". */
export const POST = apiV1Handler("files:write", async ({ req, caller }) => {
  const { parentId, name } = createFolderSchema.parse(await req.json());
  return ok(await createFolder(caller.account, parentId, name), { status: 201 });
});
