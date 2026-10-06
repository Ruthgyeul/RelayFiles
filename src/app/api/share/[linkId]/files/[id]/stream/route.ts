import { nodeIdSchema } from "@/contracts/nodes";
import { linkIdSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { serveSharedFile } from "@/server/services/share-files.service";
import { shareViewerOf } from "@/server/share/viewer";

/** A visitor's playback of a file in a share link (images: metadata removed). */
export const GET = apiHandler<Response, { linkId: string; id: string }>(async ({ req, params }) =>
  serveSharedFile(req, linkIdSchema.parse(params.linkId), nodeIdSchema.parse(params.id), "stream", await shareViewerOf(req, Date.now()), clientInfo(req.headers)),
);

export const HEAD = GET;
