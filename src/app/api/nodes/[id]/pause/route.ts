import { nodeIdSchema, pauseSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { setDownloadsPaused } from "@/server/services/node-ops.service";

/** Admin: pauses or resumes downloads of an item. */
export const PUT = apiHandler<unknown, { id: string }>(async ({ req, params }) => {
  const { account } = requireActive(await deviceOf(req));
  const { paused } = pauseSchema.parse(await req.json());
  return setDownloadsPaused(account, nodeIdSchema.parse(params.id), paused);
});
