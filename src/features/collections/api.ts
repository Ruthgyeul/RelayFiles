import type { CollectionDto, CreateCollectionInput, UpdateCollectionInput } from "@/contracts/collections";
import { apiFetch } from "@/shared/lib/api-client";

/** Collection links: several items shared through one link. */
export const collectionsApi = {
  create: (input: Partial<CreateCollectionInput> & Pick<CreateCollectionInput, "name" | "nodeIds">) => apiFetch<CollectionDto>("/api/collections", { method: "POST", json: input }),
  update: (id: string, input: UpdateCollectionInput) => apiFetch<CollectionDto>(`/api/collections/${encodeURIComponent(id)}`, { method: "PATCH", json: input }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/api/collections/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
