import { FILES } from "@/config/policy";
import type { DeletedItemDto, RestoredItem, TrashBulkInput, TrashBulkResult } from "@/contracts/trash";
import { apiFetch } from "@/shared/lib/api-client";

const entry = (id: string) => `/api/trash/${encodeURIComponent(id)}`;

/**
 * Several entries at once, in requests of at most FILES.maxBatchItems (the list shows up to
 * STORAGE.recentlyDeletedListMax). A failure stops at its request; earlier ones stay done.
 */
async function bulk(action: TrashBulkInput["action"], ids: readonly string[]): Promise<TrashBulkResult> {
  const total: TrashBulkResult = { restored: [], deleted: 0, missing: 0 };
  for (let start = 0; start < ids.length; start += FILES.maxBatchItems) {
    const part = await apiFetch<TrashBulkResult>("/api/trash/bulk", { method: "POST", json: { action, ids: ids.slice(start, start + FILES.maxBatchItems) } });
    total.restored.push(...part.restored);
    total.deleted += part.deleted;
    total.missing += part.missing;
  }
  return total;
}

/** "Recently deleted": list, restore and delete forever (one entry or several). */
export const trashApi = {
  list: () => apiFetch<DeletedItemDto[]>("/api/trash"),
  restore: (id: string) => apiFetch<RestoredItem>(`${entry(id)}/restore`, { method: "POST" }),
  deleteForever: (id: string) => apiFetch<{ deleted: true }>(entry(id), { method: "DELETE" }),
  /** "Restore all", "Empty" and Undo after a delete: several entries at once. */
  bulk,
};
