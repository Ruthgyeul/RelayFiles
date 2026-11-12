import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppEnv } from "@/config/env";
import { nodeIdSchema } from "@/contracts/nodes";
import { FavoritesPage } from "@/features/favorites/FavoritesPage";
import { currentDevice } from "@/server/auth/current";
import { ApiError } from "@/server/http/api-error";
import { favoritesView } from "@/server/services/favorites.service";
import Loading from "../../loading";

export const metadata: Metadata = { title: "Favorites" };

/** Favorites (`?folder=<organizing folder>`): items listed where they are, and organizing folders. */
export default async function FavoritesRoute({ searchParams }: PageProps<"/files/favorites">) {
  const { folder: folderParam, view: viewParam } = await searchParams;
  const folder = folderParam === undefined ? null : nodeIdSchema.safeParse(folderParam);
  if (folder && !folder.success) notFound();

  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;

  const { account } = device.active;
  const view = await favoritesView(account, folder?.data ?? null).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <FavoritesPage
      key={`${account.id}:${view.folder?.id ?? "top"}`}
      view={view}
      isAdmin={account.isAdmin}
      publicUrl={getAppEnv().PUBLIC_URL.replace(/\/$/, "")}
      initialView={typeof viewParam === "string" && nodeIdSchema.safeParse(viewParam).success ? viewParam : undefined}
    />
  );
}
