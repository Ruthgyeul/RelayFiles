import type { CreatedFolder, FolderView, NodeProperties, TaggedItem } from "@/contracts/nodes";
import { apiFetch } from "@/shared/lib/api-client";

/** File Manager API calls (reads come from the server render; these refresh or change data). */
export const filesApi = {
  getFolder: (id: string) => apiFetch<FolderView>(`/api/folders/${encodeURIComponent(id)}`),
  createFolder: (parentId: string, name: string) => apiFetch<CreatedFolder>("/api/folders", { method: "POST", json: { parentId, name } }),
  getProperties: (id: string) => apiFetch<NodeProperties>(`/api/nodes/${encodeURIComponent(id)}`),
  searchTags: (tags: string[]) => apiFetch<TaggedItem[]>(`/api/search?tags=${encodeURIComponent(tags.join(","))}`),
};
