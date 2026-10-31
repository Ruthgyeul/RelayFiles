import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnPreview } from "@/server/services/file.service";

/** The viewer's picture of the owner's image: a screen-sized WebP, or the original without one. */
export const GET = apiHandler<Response, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  return serveOwnPreview(req, account, nodeIdSchema.parse(params.id));
});

export const HEAD = GET;
