import { z } from "zod";
import { SEARCH } from "@/config/policy";
import { ID_PATTERN } from "@/domain/ids";

/** POST /api/saved-searches: a global search query as typed (stored in its normalized form). */
export const savedSearchCreateSchema = z.object({ query: z.string().trim().min(1).max(SEARCH.maxQueryLength) });

export const savedSearchIdSchema = z.string().regex(ID_PATTERN.savedSearch);

/** One saved search, oldest first in the list. */
export interface SavedSearchDto {
  id: string;
  query: string;
}
