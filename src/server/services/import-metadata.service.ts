import "server-only";
import type { ExportManifest } from "@/contracts/account-export";
import { normalizeTag } from "@/domain/tags";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { listFavoriteFolders } from "../repositories/favorite.repo";
import { findRootFolder, updateNode } from "../repositories/node.repo";
import { relativePaths } from "../repositories/node-tree.repo";
import { addFavorites, createFavoriteFolder } from "./favorites.service";

export interface MetadataResult {
  /** Items whose tags or note were set. */
  updated: number;
  /** Items added to Favorites. */
  favorites: number;
  /** Manifest entries with nothing at their path (not imported, or a file kept as "name (2)"). */
  notFound: number;
}

/**
 * Applies an export manifest after its files were imported (npm run storage:import --
 * --with-metadata): tags and notes of the items at the manifest's paths below `toSegments`,
 * then Favorites with their organizing folders (found by name, created when missing).
 * Share settings are not applied: imported items stay private until the owner shares them.
 */
export async function applyExportManifest(owner: { id: string }, toSegments: readonly string[], manifest: ExportManifest): Promise<MetadataResult> {
  const root = await findRootFolder(db(), owner.id);
  if (!root) throw new ApiError("NOT_FOUND");
  const paths = await relativePaths(db(), root.id);
  const at = (path: string, type: "FILE" | "FOLDER") => {
    const node = paths.get([...toSegments, path].join("/"));
    return node?.type === type ? node : undefined;
  };
  const result: MetadataResult = { updated: 0, favorites: 0, notFound: 0 };

  for (const item of manifest.items) {
    const node = at(item.path, item.type === "folder" ? "FOLDER" : "FILE");
    if (!node) {
      result.notFound++;
      continue;
    }
    if (item.tags.length === 0 && item.note === "") continue;
    const tags = [...new Set(item.tags.map(normalizeTag).filter(Boolean))];
    await updateNode(db(), node.id, { tags, note: item.note });
    result.updated++;
  }

  const folderIds = new Map<string, string>();
  for (const folder of await listFavoriteFolders(db(), owner.id)) folderIds.set(`${folder.parentId ?? ""}/${folder.name}`, folder.id);
  /** The organizing folder at these names, made when missing. */
  const folderAt = async (names: readonly string[]): Promise<string | null> => {
    let parent: string | null = null;
    for (const name of names) {
      const key = `${parent ?? ""}/${name}`;
      let id = folderIds.get(key);
      if (!id) {
        id = (await createFavoriteFolder(owner, parent, name)).id;
        folderIds.set(key, id);
      }
      parent = id;
    }
    return parent;
  };
  for (const names of manifest.favoriteFolders) await folderAt(names);

  const byFolder = new Map<string, { names: string[]; ids: string[] }>();
  for (const favorite of manifest.favorites) {
    const node = at(favorite.path, "FILE") ?? at(favorite.path, "FOLDER");
    if (!node) continue;
    const key = favorite.folder.join("/");
    const group = byFolder.get(key) ?? { names: favorite.folder, ids: [] };
    group.ids.push(node.id);
    byFolder.set(key, group);
  }
  for (const { names, ids } of byFolder.values()) result.favorites += (await addFavorites(owner, ids, await folderAt(names))).added;
  return result;
}
