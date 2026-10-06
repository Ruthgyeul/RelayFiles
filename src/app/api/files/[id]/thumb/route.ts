import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnThumb } from "@/server/services/file.service";

/** The thumbnail of the owner's image or video (WebP), or 404 until the worker made one. */
export const GET = apiHandler<Response, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return serveOwnThumb(req, account, nodeIdSchema.parse(params.id));
});
