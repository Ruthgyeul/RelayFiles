import { moveFavoritesSchema } from "@/contracts/favorites";
import { apiHandler } from "@/server/http/api-handler";
import { moveInFavorites } from "@/server/services/favorites.service";

/** Moves favorites and organizing folders inside Favorites. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => moveInFavorites(account, moveFavoritesSchema.parse(await req.json())));
