import { globalSearchSchema, tagSearchSchema } from "@/contracts/nodes";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { searchByTags, searchItems } from "@/server/services/node.service";

/**
 * Search in the active account.
 * - `?q=…` global search: recent files, `#tag` queries or names (Ctrl/⌘ K).
 * - `?tags=a,b` items carrying every tag (the folder search box in tag mode).
 */
export const GET = apiHandler(async ({ req }) => {
  const { account } = requireActive(await deviceOf(req));
  const params = req.nextUrl.searchParams;
  if (params.has("q")) return searchItems(account.id, globalSearchSchema.parse({ q: params.get("q") }).q);
  const { tags } = tagSearchSchema.parse({ tags: params.get("tags") ?? "" });
  return searchByTags(account.id, tags);
});
