import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { rescan } from "@/server/services/scan.service";

/** "Scan again": queues a new virus scan of a file whose scan failed. */
export const POST = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => {
  await rescan(account, nodeIdSchema.parse(params.id));
  return { queued: true };
});
