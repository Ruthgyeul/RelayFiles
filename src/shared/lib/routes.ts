import type { Route } from "next";

/** URL of a folder in the File Manager (the root is /files). */
export function folderHref(folderId: string, isRoot = false): Route {
  return (isRoot || folderId === "root" ? "/files" : `/files/${folderId}`) as Route;
}

/** The share page of a link (the owner sees it with the visitor preview bar). */
export function sharePageHref(linkId: string): Route {
  return `/d/${linkId}` as Route;
}
