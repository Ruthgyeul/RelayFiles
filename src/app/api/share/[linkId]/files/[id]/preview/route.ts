import { nodeIdSchema } from "@/contracts/nodes";
import { linkIdSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { serveSharedPreview } from "@/server/share/share-files.service";
import { shareViewerOf } from "@/server/share/viewer";

/** The viewer's picture of an image in a share link: a screen-sized WebP without metadata. */
export const GET = apiHandler<Response, { linkId: string; id: string }>(async ({ req, params }) =>
  serveSharedPreview(req, linkIdSchema.parse(params.linkId), nodeIdSchema.parse(params.id), await shareViewerOf(req, Date.now()), clientInfo(req.headers)),
);

export const HEAD = GET;
