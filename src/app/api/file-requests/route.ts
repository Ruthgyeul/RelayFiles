import { createFileRequestSchema } from "@/contracts/file-requests";
import { folderRefSchema } from "@/contracts/nodes";
import { apiHandler, ok } from "@/server/http/api-handler";
import { createFileRequest, listFileRequests } from "@/server/services/file-request.service";

/** Upload-only links to a folder of the active account: `?folder=<root|id>`. */
export const GET = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => listFileRequests(account, folderRefSchema.parse(req.nextUrl.searchParams.get("folder"))));

/** A new upload-only link `{ folderId, title, password, expiresInDays, maxFiles, maxMb }`. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return ok(await createFileRequest(account, createFileRequestSchema.parse(await req.json())), { status: 201 });
});
