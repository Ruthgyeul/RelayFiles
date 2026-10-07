import { nodeIdSchema } from "@/contracts/nodes";
import { linkIdSchema } from "@/contracts/share";
import { apiHandler } from "@/server/http/api-handler";
import { serveSharedThumb } from "@/server/services/share-files.service";
import { shareViewerOf } from "@/server/share/viewer";

/** The list preview (WebP) of an image or video in a share link, or 404 until the worker made one. */
export const GET = apiHandler<Response, { linkId: string; id: string }>(async ({ req, params }) =>
  serveSharedThumb(req, linkIdSchema.parse(params.linkId), nodeIdSchema.parse(params.id), await shareViewerOf(req, Date.now())),
);
