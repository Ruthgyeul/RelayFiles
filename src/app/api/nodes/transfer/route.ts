import { moveSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { copyNodes, moveNodes } from "@/server/services/transfer.service";

/** Moves or copies items into a folder. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { ids, targetId, mode } = moveSchema.parse(await req.json());
  return mode === "copy" ? copyNodes(account, ids, targetId) : moveNodes(account, ids, targetId);
});
