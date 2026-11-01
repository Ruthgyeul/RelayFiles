import { globalSearchSchema, tagSearchSchema } from "@/contracts/nodes";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { searchByTags, searchItems } from "@/server/services/node.service";

/**
 * Searches the token's account like the web app:
 * - `?q=…` recent files (empty), items with every `#tag`, or names.
 * - `?tags=a,b` every item carrying all the tags.
 */
export const GET = apiV1Handler("files:read", async ({ req, caller }) => {
  const params = req.nextUrl.searchParams;
  if (params.has("q")) return searchItems(caller.account.id, globalSearchSchema.parse({ q: params.get("q") }).q);
  const { tags } = tagSearchSchema.parse({ tags: params.get("tags") ?? "" });
  return searchByTags(caller.account.id, tags);
});
