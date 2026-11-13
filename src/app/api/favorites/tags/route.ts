import { tagSearchSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { searchFavoriteTags } from "@/server/services/favorites.service";

/** `?tags=a,b`: favorites in any organizing folder that carry every tag (the Favorites search box in tag mode). */
export const GET = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { tags } = tagSearchSchema.parse({ tags: req.nextUrl.searchParams.get("tags") ?? "" });
  return searchFavoriteTags(account, tags);
});
