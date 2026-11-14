import type { TimelinePage } from "@/contracts/timeline";
import { apiFetch } from "@/shared/lib/api-client";

/** One page of "Photos" after `cursor` (the first page comes with the page itself). */
export const photosApi = {
  page: (cursor: string) => apiFetch<TimelinePage>(`/api/timeline?cursor=${encodeURIComponent(cursor)}`),
};
