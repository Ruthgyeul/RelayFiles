"use client";

import type { FavoriteFolderPage } from "@/contracts/favorites";
import { FileManager, type FolderNav } from "@/features/files/FileManager";
import { favoriteFolderHref, favoritesHref } from "@/shared/lib/routes";

interface Props {
  page: FavoriteFolderPage;
  isAdmin: boolean;
  publicUrl: string;
  initialView?: string;
}

/**
 * A real folder opened from Favorites: the usual File Manager, with the path it was reached by
 * ("Favorites › organizing folders › the favorite › …") and subfolders opening along it.
 */
export function FavoriteFolderManager({ page, isAdmin, publicUrl, initialView }: Props) {
  const { groups, chain } = page;
  const chainIds = chain.map((crumb) => crumb.id);
  const nav: FolderNav = {
    path: [{ id: "favorites", name: "Favorites" }, ...groups, ...chain],
    rootIcon: "star",
    hrefOf: (index) => (index === 0 ? favoritesHref() : index <= groups.length ? favoritesHref(groups[index - 1]!.id) : favoriteFolderHref(chainIds.slice(0, index - groups.length))),
    folderHref: (id) => favoriteFolderHref([...chainIds, id]),
  };
  return <FileManager key={page.view.folder.id} view={page.view} nav={nav} isAdmin={isAdmin} publicUrl={publicUrl} initialView={initialView} />;
}
