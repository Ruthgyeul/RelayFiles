import { fileVersionIdSchema, nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { removeFileVersion } from "@/server/services/file-version.service";

/** Deletes an earlier version for good. */
export const DELETE = apiHandler<{ deleted: true }, { id: string; vid: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  await removeFileVersion(account, nodeIdSchema.parse(params.id), fileVersionIdSchema.parse(params.vid));
  return { deleted: true };
});
