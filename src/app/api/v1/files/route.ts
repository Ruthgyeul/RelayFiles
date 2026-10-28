import { apiV1UploadQuerySchema } from "@/contracts/api-tokens";
import { ApiError } from "@/server/http/api-error";
import { ok } from "@/server/http/api-handler";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { uploadFromApi } from "@/server/services/api-v1.service";

/**
 * Uploads one file as the whole request body: `POST /api/v1/files?folder=<root|id>&name=<name>`
 * with Content-Length (ShareX, curl --data-binary). Answers with the item and its share link.
 */
export const POST = apiV1Handler("files:write", async ({ req, caller }) => {
  const query = apiV1UploadQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const size = Number(req.headers.get("content-length"));
  if (!req.body || !Number.isSafeInteger(size) || size < 0) throw new ApiError("BAD_REQUEST", "Send the file as the request body with a Content-Length.");
  return ok(await uploadFromApi(caller, query.folder, query.name, size, req.body), { status: 201 });
});
