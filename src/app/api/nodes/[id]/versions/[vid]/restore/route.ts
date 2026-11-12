import { fileVersionIdSchema, nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { restoreFileVersion } from "@/server/services/file-version.service";

/** Makes an earlier version the current file; the current one becomes a version. Returns the file's new id. */
export const POST = apiHandler<{ nodeId: string }, { id: string; vid: string }>({ auth: "active" }, async ({ params, active: { account } }) =>
  restoreFileVersion(account, nodeIdSchema.parse(params.id), fileVersionIdSchema.parse(params.vid)),
);
