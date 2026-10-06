import { tagSearchSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { searchByTags } from "@/server/services/node.service";

/** Items anywhere in the active account that carry every tag: /api/search?tags=a,b */
export const GET = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  const { tags } = tagSearchSchema.parse({ tags: req.nextUrl.searchParams.get("tags") ?? "" });
  return searchByTags(account.id, tags);
});
