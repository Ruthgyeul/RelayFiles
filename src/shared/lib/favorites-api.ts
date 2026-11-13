import type { FavoriteFolderDeleteMode, FavoriteFolderDto, FavoritesView } from "@/contracts/favorites";
import type { TaggedItem } from "@/contracts/nodes";
import { apiFetch } from "@/shared/lib/api-client";

const folder = (id: string) => `/api/favorites/folders/${encodeURIComponent(id)}`;

/** Favorites API calls (docs/api.md "즐겨찾기"); the File Manager adds and removes, the Favorites page organizes. */
export const favoritesApi = {
  view: (folderId?: string | null) => apiFetch<FavoritesView>(folderId ? `/api/favorites?folder=${encodeURIComponent(folderId)}` : "/api/favorites"),
  add: (nodeIds: string[], folderId: string | null = null) => apiFetch<{ added: number }>("/api/favorites", { method: "POST", json: { nodeIds, folderId } }),
  remove: (nodeIds: string[]) => apiFetch<{ removed: number }>("/api/favorites/remove", { method: "POST", json: { nodeIds } }),
  move: (nodeIds: string[], folderIds: string[], to: string | null) => apiFetch<{ moved: number }>("/api/favorites/move", { method: "POST", json: { nodeIds, folderIds, to } }),
  createFolder: (parentId: string | null, name: string) => apiFetch<FavoriteFolderDto>("/api/favorites/folders", { method: "POST", json: { parentId, name } }),
  renameFolder: (id: string, name: string) => apiFetch<{ id: string; name: string }>(folder(id), { method: "PATCH", json: { name } }),
  favoritesInside: (id: string) => apiFetch<{ favorites: number }>(folder(id)),
  /** Favorites in any organizing folder carrying every tag. */
  searchTags: (tags: string[]) => apiFetch<TaggedItem[]>(`/api/favorites/tags?tags=${encodeURIComponent(tags.join(","))}`),
  deleteFolder: (id: string, mode: FavoriteFolderDeleteMode) => apiFetch<{ removedFavorites: number; movedUp: number }>(`${folder(id)}?mode=${mode}`, { method: "DELETE" }),
};
