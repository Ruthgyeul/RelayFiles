import type { DeletedItemDto, RestoredItem } from "@/contracts/trash";
import { apiFetch } from "@/shared/lib/api-client";

const entry = (id: string) => `/api/trash/${encodeURIComponent(id)}`;

/** "Recently deleted": list, restore and delete forever. */
export const trashApi = {
  list: () => apiFetch<DeletedItemDto[]>("/api/trash"),
  restore: (id: string) => apiFetch<RestoredItem>(`${entry(id)}/restore`, { method: "POST" }),
  deleteForever: (id: string) => apiFetch<{ deleted: true }>(entry(id), { method: "DELETE" }),
};
