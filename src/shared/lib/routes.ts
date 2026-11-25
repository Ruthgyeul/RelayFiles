import type { Route } from "next";

/** URL of a folder in the File Manager (the root is /files). */
export function folderHref(folderId: string, isRoot = false): Route {
  return (isRoot || folderId === "root" ? "/files" : `/files/${folderId}`) as Route;
}

/** The share page of a link (the owner sees it with the visitor preview bar). */
export function sharePageHref(linkId: string): Route {
  return `/d/${linkId}` as Route;
}

/** The full share link of a node, for copying (`publicUrl` without a trailing slash). */
export function shareUrl(publicUrl: string, linkId: string): string {
  return `${publicUrl}${sharePageHref(linkId)}`;
}

/** "All Files": every file of the account, without folders. */
export function allFilesHref(): Route {
  return "/files/all" as Route;
}

/** Favorites, or one of its organizing folders. */
export function favoritesHref(folderId?: string | null): Route {
  return (folderId ? `/files/favorites?folder=${encodeURIComponent(folderId)}` : "/files/favorites") as Route;
}

/** A real folder opened from Favorites: the favorite folder, then each folder opened below it. */
export function favoriteFolderHref(chain: readonly string[]): Route {
  return `/files/favorites/${chain.map(encodeURIComponent).join("/")}` as Route;
}
