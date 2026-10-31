import { fileRequestIdSchema, requestUploadSchema } from "@/contracts/file-requests";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { prepareRequestUpload } from "@/server/services/file-request.service";
import { unlocksOfRequest } from "@/server/share/viewer";

/** Plans a visitor upload through an upload-only link; the files are then sent with tus. */
export const POST = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const now = Date.now();
  return prepareRequestUpload(fileRequestIdSchema.parse(params.id), requestUploadSchema.parse(await req.json()), unlocksOfRequest(req, now), clientInfo(req.headers), now);
});
