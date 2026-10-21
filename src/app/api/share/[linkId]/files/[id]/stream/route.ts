import { nodeIdSchema } from "@/contracts/nodes";
import { linkIdSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { serveSharedFile, serveSharedTranscode } from "@/server/services/share-files.service";
import { shareViewerOf } from "@/server/share/viewer";

/**
 * A visitor's playback of a file in a share link (images: metadata removed).
 * `?transcode=1` converts a video the browser cannot decode while it plays.
 */
export const GET = apiHandler<Response, { linkId: string; id: string }>(async ({ req, params }) => {
  const [linkId, id] = [linkIdSchema.parse(params.linkId), nodeIdSchema.parse(params.id)];
  const viewer = await shareViewerOf(req, Date.now());
  return req.nextUrl.searchParams.get("transcode") === "1"
    ? serveSharedTranscode(req, linkId, id, viewer, clientInfo(req.headers))
    : serveSharedFile(req, linkId, id, "stream", viewer, clientInfo(req.headers));
});

export const HEAD = GET;
