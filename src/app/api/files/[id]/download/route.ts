import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnFile } from "@/server/services/file.service";

/** The owner's download of a file (attachment, original bytes). */
export const GET = apiHandler<Response, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  return serveOwnFile(req, account, nodeIdSchema.parse(params.id), "download");
});

export const HEAD = GET;
