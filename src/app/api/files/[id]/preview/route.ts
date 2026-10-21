import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnPreview } from "@/server/services/file.service";

/** The viewer's picture of the owner's image: a screen-sized WebP, or the original without one. */
export const GET = apiHandler<Response, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return serveOwnPreview(req, account, nodeIdSchema.parse(params.id));
});

export const HEAD = GET;
