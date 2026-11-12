import { deleteFavoriteFolderQuerySchema, renameFavoriteFolderSchema } from "@/contracts/favorites";
import { nodeIdSchema } from "@/contracts/nodes";
import { apiHandler } from "@/server/http/api-handler";
import { deleteFavoriteFolder, favoritesInside, renameFavoriteFolder } from "@/server/services/favorites.service";

/** How many favorites the folder holds, its subfolders included (for the delete dialog). */
export const GET = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => ({
  favorites: await favoritesInside(account, nodeIdSchema.parse(params.id)),
}));

export const PATCH = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const { name } = renameFavoriteFolderSchema.parse(await req.json());
  return renameFavoriteFolder(account, nodeIdSchema.parse(params.id), name);
});

/** `?mode=remove` drops the favorites inside; `?mode=lift` moves them and subfolders up a level. */
export const DELETE = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) => {
  const { mode } = deleteFavoriteFolderQuerySchema.parse({ mode: req.nextUrl.searchParams.get("mode") });
  return deleteFavoriteFolder(account, nodeIdSchema.parse(params.id), mode);
});
