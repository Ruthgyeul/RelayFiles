import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnFile, serveOwnTranscode } from "@/server/services/file.service";

/**
 * The owner's inline playback of a file (media types only; Range for seeking).
 * `?transcode=1` converts a video the browser cannot decode while it plays.
 */
export const GET = apiHandler<Response, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  const id = nodeIdSchema.parse(params.id);
  return req.nextUrl.searchParams.get("transcode") === "1" ? serveOwnTranscode(req, account, id) : serveOwnFile(req, account, id, "stream");
});

export const HEAD = GET;
