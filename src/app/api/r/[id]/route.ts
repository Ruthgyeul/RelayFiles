import { fileRequestIdSchema } from "@/contracts/file-requests";
import { apiHandler } from "@/server/http/api-handler";
import { requestView } from "@/server/services/file-request.service";
import { unlocksOfRequest } from "@/server/share/viewer";

/** What an upload-only link is for and how much it still takes (public). */
export const GET = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const now = Date.now();
  return requestView(fileRequestIdSchema.parse(params.id), unlocksOfRequest(req, now), now);
});
