import { addFavoritesSchema, favoriteFolderQuerySchema } from "@/contracts/favorites";
import { apiHandler, ok } from "@/server/http/api-handler";
import { addFavorites, favoritesView } from "@/server/services/favorites.service";

/** One level of Favorites: `?folder=<organizing folder id>`, the top without it. */
export const GET = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { folder } = favoriteFolderQuerySchema.parse({ folder: req.nextUrl.searchParams.get("folder") ?? undefined });
  return favoritesView(account, folder ?? null);
});

/** Adds items to Favorites (where they are; nothing is copied). */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { nodeIds, folderId } = addFavoritesSchema.parse(await req.json());
  return ok(await addFavorites(account, nodeIds, folderId), { status: 201 });
});
