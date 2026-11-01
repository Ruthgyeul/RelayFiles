import type {
  CreatedFolder,
  DuplicatesResult,
  FolderNode,
  FolderView,
  LinkEventDto,
  NodeItem,
  NodeProperties,
  RenumberPreview,
  RenumberResult,
  SettingsInput,
  TaggedItem,
  TransferResult,
} from "@/contracts/nodes";
import type { RenumberOrder, RenumberSort } from "@/domain/renumber";
import { apiFetch } from "@/shared/lib/api-client";

const node = (id: string) => `/api/nodes/${encodeURIComponent(id)}`;

/** URLs the browser loads directly (media elements, downloads). */
export const fileUrls = {
  stream: (id: string) => `/api/files/${encodeURIComponent(id)}/stream`,
  thumb: (id: string) => `/api/files/${encodeURIComponent(id)}/thumb`,
  /** Screen-sized picture of an image (the original when there is none). */
  preview: (id: string) => `/api/files/${encodeURIComponent(id)}/preview`,
  /** A video converted while it plays (containers the browser cannot decode). */
  transcode: (id: string) => `/api/files/${encodeURIComponent(id)}/stream?transcode=1`,
  download: (id: string) => `/api/files/${encodeURIComponent(id)}/download`,
  zip: (ids: string[]) => `/api/zip?ids=${ids.map(encodeURIComponent).join(",")}`,
  /** The item's link activity as a CSV download. */
  activityCsv: (id: string) => `${node(id)}/activity/csv`,
};

/** File Manager API calls (reads come from the server render; these refresh or change data). */
export const filesApi = {
  getFolder: (id: string) => apiFetch<FolderView>(`/api/folders/${encodeURIComponent(id)}`),
  folderTree: () => apiFetch<FolderNode[]>("/api/folders/tree"),
  createFolder: (parentId: string, name: string) => apiFetch<CreatedFolder>("/api/folders", { method: "POST", json: { parentId, name } }),
  getProperties: (id: string) => apiFetch<NodeProperties>(node(id)),
  rename: (id: string, name: string) => apiFetch<NodeItem>(node(id), { method: "PATCH", json: { name } }),
  transfer: (ids: string[], targetId: string, mode: "move" | "copy") => apiFetch<TransferResult>("/api/nodes/transfer", { method: "POST", json: { ids, targetId, mode } }),
  remove: (ids: string[]) => apiFetch<{ deleted: number }>("/api/nodes/delete", { method: "POST", json: { ids } }),
  tags: (ids: string[], add: string[], remove: string[]) => apiFetch<{ updated: number }>("/api/nodes/tags", { method: "POST", json: { ids, add, remove } }),
  tagUsage: () => apiFetch<{ tag: string; count: number }[]>("/api/tags"),
  saveSettings: (id: string, settings: SettingsInput) => apiFetch<NodeItem>(`${node(id)}/settings`, { method: "PUT", json: settings }),
  newLink: (id: string) => apiFetch<NodeItem>(`${node(id)}/link`, { method: "POST" }),
  activity: (id: string) => apiFetch<LinkEventDto[]>(`${node(id)}/activity`),
  setPaused: (id: string, paused: boolean) => apiFetch<NodeItem>(`${node(id)}/pause`, { method: "PUT", json: { paused } }),
  renumberPreview: (folderId: string, sort: RenumberSort, order: RenumberOrder) => apiFetch<RenumberPreview>(`${node(folderId)}/renumber?sort=${sort}&order=${order}`),
  /** `expect` = the files whose name changes (plan order), `count` = files the plan numbered. */
  renumber: (folderId: string, sort: RenumberSort, order: RenumberOrder, expect: { id: string; to: string }[], count: number) =>
    apiFetch<RenumberResult>(`${node(folderId)}/renumber`, { method: "POST", json: { sort, order, expect, count } }),
  duplicates: (folderId: string, recursive: boolean) => apiFetch<DuplicatesResult>(`${node(folderId)}/duplicates?recursive=${recursive ? 1 : 0}`),
  searchTags: (tags: string[]) => apiFetch<TaggedItem[]>(`/api/search?tags=${encodeURIComponent(tags.join(","))}`),
};
