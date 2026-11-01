import { resumeUploadSchema } from "@/contracts/uploads";
import { apiHandler } from "@/server/http/api-handler";
import { resumeUpload } from "@/server/upload/resume";

/** Hands an unfinished upload of this account to a file of a new batch (resuming after a reload). */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return resumeUpload(account, resumeUploadSchema.parse(await req.json()));
});
