import { nodeIdSchema } from "@/contracts/nodes";
import { linkIdSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler } from "@/server/http/api-handler";
import { checkSharedFolder, zipSharedFolder } from "@/server/services/share-files.service";
import { shareViewerOf } from "@/server/share/viewer";

/** "Download all": the visible contents of a folder in a share link as one zip (?folder=id). */
export const GET = apiHandler<Response, { linkId: string }>(async ({ req, params }) =>
  zipSharedFolder(linkIdSchema.parse(params.linkId), nodeIdSchema.parse(req.nextUrl.searchParams.get("folder")), await shareViewerOf(req, Date.now()), clientInfo(req.headers)),
);

/** Whether the zip would be served (busy, stream-only, …) without counting a download. */
export const HEAD = apiHandler<Response, { linkId: string }>(async ({ req, params }) =>
  checkSharedFolder(linkIdSchema.parse(params.linkId), nodeIdSchema.parse(req.nextUrl.searchParams.get("folder")), await shareViewerOf(req, Date.now())),
);
