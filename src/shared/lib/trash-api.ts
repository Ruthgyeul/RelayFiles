import type { DeletedItemDto, RestoredItem, TrashBulkInput, TrashBulkResult } from "@/contracts/trash";
import { apiFetch } from "@/shared/lib/api-client";

const entry = (id: string) => `/api/trash/${encodeURIComponent(id)}`;

/** "Recently deleted": list, restore and delete forever (one entry or several). */
export const trashApi = {
  list: () => apiFetch<DeletedItemDto[]>("/api/trash"),
  restore: (id: string) => apiFetch<RestoredItem>(`${entry(id)}/restore`, { method: "POST" }),
  deleteForever: (id: string) => apiFetch<{ deleted: true }>(entry(id), { method: "DELETE" }),
  /** "Restore all", "Empty" and Undo after a delete: several entries at once. */
  bulk: (action: TrashBulkInput["action"], ids: string[]) => apiFetch<TrashBulkResult>("/api/trash/bulk", { method: "POST", json: { action, ids } }),
};
