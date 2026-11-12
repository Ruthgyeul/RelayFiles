import { fileVersionIdSchema, nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { sendFile } from "@/server/http/send-file";
import { fileVersionContent } from "@/server/services/file-version.service";

/** Downloads an earlier version (an attachment named like the file, Range supported). */
export const GET = apiHandler<Response, { id: string; vid: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const nodeId = nodeIdSchema.parse(params.id);
  const { driver, name, mime, sha256, source } = await fileVersionContent(account, nodeId, fileVersionIdSchema.parse(params.vid));
  return sendFile(req, { driver, location: { accountId: account.id, segments: [] }, name, mime: mime ?? "application/octet-stream", size: source.size, etag: sha256, mode: "download", body: source });
});
