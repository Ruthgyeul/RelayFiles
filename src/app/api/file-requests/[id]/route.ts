import { fileRequestIdSchema } from "@/contracts/file-requests";
import { apiHandler } from "@/server/http/api-handler";
import { removeFileRequest } from "@/server/services/file-request.service";

/** Deletes an upload-only link; files it brought in stay in the folder. */
export const DELETE = apiHandler<{ deleted: true }, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  await removeFileRequest(account.id, fileRequestIdSchema.parse(params.id));
  return { deleted: true };
});
