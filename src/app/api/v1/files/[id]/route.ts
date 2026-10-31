import { apiV1Handler } from "@/server/http/api-v1-handler";
import { serveOwnFile } from "@/server/services/file.service";

/** Downloads a file in its original bytes (Range and ETag as in the web app). */
export const GET = apiV1Handler<Response, { id: string }>("files:read", async ({ req, params, caller }) => serveOwnFile(req, caller.account, params.id, "download"));
