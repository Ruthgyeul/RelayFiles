import { apiV1SharePatchSchema, type ApiV1Share } from "@/contracts/api-tokens";
import { nodeIdSchema } from "@/contracts/nodes";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { shareOf, updateShareFromApi } from "@/server/services/api-v1.service";

/** An item's share link (`linkId`, `url`) and settings. */
export const GET = apiV1Handler<ApiV1Share, { id: string }>("files:read", async ({ params, caller }) => shareOf(caller, nodeIdSchema.parse(params.id)));

/** Changes the share settings sent (others keep their values); `password: null` removes the password. */
export const PATCH = apiV1Handler<ApiV1Share, { id: string }>("files:write", async ({ req, params, caller }) => {
  return updateShareFromApi(caller, nodeIdSchema.parse(params.id), apiV1SharePatchSchema.parse(await req.json()));
});
