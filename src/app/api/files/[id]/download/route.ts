import { nodeIdSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { serveOwnFile } from "@/server/services/file.service";

/** The owner's download of a file (attachment, original bytes). */
export const GET = apiHandler<Response, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  return serveOwnFile(req, account, nodeIdSchema.parse(params.id), "download");
});

export const HEAD = GET;
