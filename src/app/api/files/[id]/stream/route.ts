import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnFile } from "@/server/services/file.service";

/** The owner's inline playback of a file (media types only; Range for seeking). */
export const GET = apiHandler<Response, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return serveOwnFile(req, account, nodeIdSchema.parse(params.id), "stream");
});

export const HEAD = GET;
