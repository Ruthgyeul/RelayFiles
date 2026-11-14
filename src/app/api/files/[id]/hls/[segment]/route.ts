import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnHls } from "@/server/services/file.service";

/**
 * The owner's video converted for HLS: `index.m3u8` lists every segment, `<n>.ts` is one,
 * converted when asked for (seeking anywhere starts the conversion there).
 */
export const GET = apiHandler<Response, { id: string; segment: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  return serveOwnHls(account, nodeIdSchema.parse(params.id), params.segment);
});
