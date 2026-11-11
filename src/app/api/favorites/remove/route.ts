import { removeFavoritesSchema } from "@/contracts/favorites";
import { apiHandler } from "@/server/http/api-handler";
import { removeFavorites } from "@/server/services/favorites.service";

/** Takes items out of Favorites; the items themselves are not touched. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { nodeIds } = removeFavoritesSchema.parse(await req.json());
  return removeFavorites(account, nodeIds);
});
