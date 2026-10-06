import { prepareUploadSchema } from "@/contracts/uploads";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { prepareUpload } from "@/server/services/upload.service";

/** Plans an upload batch: duplicates, quota, Home folder; returns the tus endpoint and files to send. */
export const POST = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  return prepareUpload(account, prepareUploadSchema.parse(await req.json()));
});
