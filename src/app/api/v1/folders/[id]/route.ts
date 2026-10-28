import { folderRefSchema } from "@/contracts/nodes";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { getFolderView } from "@/server/services/node.service";

/** A folder ("root" or an id) with its path and children, as in the web app. */
export const GET = apiV1Handler<unknown, { id: string }>("files:read", async ({ params, caller }) => getFolderView(caller.account.id, folderRefSchema.parse(params.id)));
