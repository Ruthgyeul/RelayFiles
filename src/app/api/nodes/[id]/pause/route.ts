import { nodeIdSchema, pauseSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { setDownloadsPaused } from "@/server/services/node-settings.service";

/** Admin: pauses or resumes downloads of an item. */
export const PUT = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const { paused } = pauseSchema.parse(await req.json());
  return setDownloadsPaused(account, nodeIdSchema.parse(params.id), paused);
});
