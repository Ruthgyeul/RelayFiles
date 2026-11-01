import type { ApiV1Share } from "@/contracts/api-tokens";
import { nodeIdSchema } from "@/contracts/nodes";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { regenerateLinkFromApi } from "@/server/services/api-v1.service";

/** Replaces an item's share link; the old link stops working at once. */
export const POST = apiV1Handler<ApiV1Share, { id: string }>("files:write", async ({ params, caller }) => regenerateLinkFromApi(caller, nodeIdSchema.parse(params.id)));
