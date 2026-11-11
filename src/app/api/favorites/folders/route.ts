import { createFavoriteFolderSchema } from "@/contracts/favorites";
import { apiHandler, ok } from "@/server/http/api-handler";
import { createFavoriteFolder } from "@/server/services/favorites.service";

/** Makes an organizing folder inside Favorites (a taken name is 409). */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  const { parentId, name } = createFavoriteFolderSchema.parse(await req.json());
  return ok(await createFavoriteFolder(account, parentId, name), { status: 201 });
});
