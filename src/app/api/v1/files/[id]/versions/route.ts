import { nodeIdSchema } from "@/contracts/nodes";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { fileVersions } from "@/server/services/file-version.service";

/** Earlier versions of a file, newest first. */
export const GET = apiV1Handler<unknown, { id: string }>("files:read", async ({ params, caller }) => fileVersions(caller.account.id, nodeIdSchema.parse(params.id)));
