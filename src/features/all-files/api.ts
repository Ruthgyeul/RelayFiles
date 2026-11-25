import type { AllFilesKind, AllFilesPage } from "@/contracts/all-files";
import type { AllFilesSort } from "@/domain/all-files";
import { apiFetch } from "@/shared/lib/api-client";

export interface AllFilesRequest {
  sort: AllFilesSort;
  kind: AllFilesKind;
  q: string;
}

/** One page of "All Files" (the first comes with the page itself; `cursor` asks for the next). */
export const allFilesApi = {
  page: ({ sort, kind, q }: AllFilesRequest, cursor: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ sort, kind, q });
    if (cursor) params.set("cursor", cursor);
    return apiFetch<AllFilesPage>(`/api/files/all?${params.toString()}`, { signal });
  },
};
