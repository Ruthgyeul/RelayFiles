import { apiV1NodePatchSchema } from "@/contracts/api-tokens";
import { nodeIdSchema, type NodeItem } from "@/contracts/nodes";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { updateNodeFromApi } from "@/server/services/api-v1.service";
import { deleteItems } from "@/server/services/node-ops.service";

/** Renames and/or moves a file or folder `{ name?, parentId? }`; a name taken where it ends up is a 409. */
export const PATCH = apiV1Handler<NodeItem, { id: string }>("files:write", async ({ req, params, caller }) => {
  return updateNodeFromApi(caller, nodeIdSchema.parse(params.id), apiV1NodePatchSchema.parse(await req.json()));
});

/** Deletes a file or a folder with everything inside (it goes to the volume's trash). */
export const DELETE = apiV1Handler<{ deleted: number }, { id: string }>("files:write", async ({ params, caller }) => deleteItems(caller.account, [params.id]));
