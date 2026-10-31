import { prepareUploadSchema } from "@/contracts/uploads";
import { apiHandler } from "@/server/http/api-handler";
import { prepareUpload } from "@/server/services/upload.service";

/** Plans an upload batch: duplicates, quota, Home folder; returns the tus endpoint and files to send. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return prepareUpload(account, prepareUploadSchema.parse(await req.json()));
});
