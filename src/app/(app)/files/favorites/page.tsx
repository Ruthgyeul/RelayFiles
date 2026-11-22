import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { nodeIdSchema } from "@/contracts/nodes";
import { FavoritesPage } from "@/features/favorites/FavoritesPage";
import { ApiError } from "@/server/http/api-error";
import { favoritesView } from "@/server/services/favorites.service";
import { initialViewOf, withActiveAccount } from "../../with-active-account";

export const metadata: Metadata = { title: "Favorites" };

/** Favorites (`?folder=<organizing folder>`): items listed where they are, and organizing folders. */
export default async function FavoritesRoute({ searchParams }: PageProps<"/files/favorites">) {
  const { folder: folderParam, view: viewParam } = await searchParams;
  const folder = folderParam === undefined ? null : nodeIdSchema.safeParse(folderParam);
  if (folder && !folder.success) notFound();

  return withActiveAccount(async ({ account }) => {
    const view = await favoritesView(account, folder?.data ?? null).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    });
    return <FavoritesPage key={`${account.id}:${view.folder?.id ?? "top"}`} view={view} isAdmin={account.isAdmin} initialView={initialViewOf(viewParam)} />;
  });
}
