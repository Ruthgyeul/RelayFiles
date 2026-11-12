import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { fileVersions } from "@/server/services/file-version.service";

/** A file's earlier versions, newest first (Version history). */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => fileVersions(account.id, nodeIdSchema.parse(params.id)));
