import { notFound } from "next/navigation";
import { FILES } from "@/config/policy";
import { nodeIdSchema } from "@/contracts/nodes";
import { FavoriteFolderManager } from "@/features/favorites/FavoriteFolderManager";
import { ApiError } from "@/server/http/api-error";
import { favoriteFolderPage } from "@/server/services/favorites.service";
import { initialViewOf, withActiveAccount } from "../../../with-active-account";

/** A favorite folder opened from Favorites: /files/favorites/<favorite>/<subfolder>/… */
export default async function FavoriteFolderRoute({ params, searchParams }: PageProps<"/files/favorites/[...ids]">) {
  const [{ ids }, { view: viewParam }] = await Promise.all([params, searchParams]);
  const chain = nodeIdSchema.array().min(1).max(FILES.maxFavoriteChain).safeParse(ids);
  if (!chain.success) notFound();

  return withActiveAccount(async ({ account }) => {
    const page = await favoriteFolderPage(account, chain.data).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    });
    return <FavoriteFolderManager page={page} isAdmin={account.isAdmin} initialView={initialViewOf(viewParam)} />;
  });
}
