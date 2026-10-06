import type { Route } from "next";

/** URL of a folder in the File Manager (the root is /files). */
export function folderHref(folderId: string, isRoot = false): Route {
  return (isRoot || folderId === "root" ? "/files" : `/files/${folderId}`) as Route;
}
