import { apiV1PrepareUploadSchema } from "@/contracts/uploads";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { prepareUpload } from "@/server/services/upload.service";

/**
 * Plans a batch a script sends over tus with this same token (large files, resuming): the
 * same checks as the web app's upload (names, item limit, space), without a Home folder.
 */
export const POST = apiV1Handler("files:write", async ({ req, caller }) => {
  const { folder, files, dup } = apiV1PrepareUploadSchema.parse(await req.json());
  return prepareUpload(caller.account, { target: folder, files, dup }, { apiTokenId: caller.tokenId });
});
