import { favoriteFolderQuerySchema } from "@/contracts/favorites";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { favoritesView } from "@/server/services/favorites.service";

/** One level of the token account's Favorites (`?folder=<organizing folder id>`). */
export const GET = apiV1Handler("files:read", async ({ req, caller }) => {
  const { folder } = favoriteFolderQuerySchema.parse({ folder: req.nextUrl.searchParams.get("folder") ?? undefined });
  return favoritesView(caller.account, folder ?? null);
});
