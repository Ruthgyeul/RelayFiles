import { nodeIdSchema } from "@/contracts/nodes";
import { linkIdSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { serveSharedHls } from "@/server/share/share-files.service";
import { shareViewerOf } from "@/server/share/viewer";

/** A visitor's HLS playback of a video in a share link (see /api/files/[id]/hls/[segment]). */
export const GET = apiHandler<Response, { linkId: string; id: string; segment: string }>(async ({ req, params }) => {
  const [linkId, id] = [linkIdSchema.parse(params.linkId), nodeIdSchema.parse(params.id)];
  return serveSharedHls(req, linkId, id, params.segment, await shareViewerOf(req, Date.now()), clientInfo(req.headers));
});
