import { apiV1Handler } from "@/server/http/api-v1-handler";
import { deleteItems } from "@/server/services/node-ops.service";

/** Deletes a file or a folder with everything inside (it goes to the volume's trash). */
export const DELETE = apiV1Handler<{ deleted: number }, { id: string }>("files:write", async ({ params, caller }) => deleteItems(caller.account, [params.id]));
