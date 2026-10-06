import { moveSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { copyNodes, moveNodes } from "@/server/services/node-ops.service";

/** Moves or copies items into a folder. */
export const POST = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  const { ids, targetId, mode } = moveSchema.parse(await req.json());
  return mode === "copy" ? copyNodes(account, ids, targetId) : moveNodes(account, ids, targetId);
});
