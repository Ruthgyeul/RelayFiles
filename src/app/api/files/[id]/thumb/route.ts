import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnThumb } from "@/server/services/file.service";

/** The thumbnail of the owner's image or video (WebP), or 404 until the worker made one. */
export const GET = apiHandler<Response, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  return serveOwnThumb(req, account, nodeIdSchema.parse(params.id));
});
