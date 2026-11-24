import "server-only";
import { SEARCH } from "@/config/policy";
import type { SavedSearchDto } from "@/contracts/saved-searches";
import { newSavedSearchId } from "@/domain/ids";
import { formatSearchQuery, parseSearchQuery } from "@/domain/search";
import { db } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { countSavedSearches, createSavedSearch, deleteSavedSearch, findSavedSearch, listSavedSearches } from "../repositories/saved-search.repo";

export function savedSearches(accountId: string): Promise<SavedSearchDto[]> {
  return listSavedSearches(db(), accountId);
}

/**
 * Keeps a global search query, written in its normalized form ("#trip type:image beach"), so
 * the same search typed differently is kept once. Saving it again returns the one kept.
 */
export async function saveSearch(accountId: string, raw: string): Promise<SavedSearchDto> {
  const query = formatSearchQuery(parseSearchQuery(raw));
  if (!query) throw new ApiError("BAD_REQUEST", "Type something to search for first.");
  const existing = await findSavedSearch(db(), accountId, query);
  if (existing) return existing;
  if ((await countSavedSearches(db(), accountId)) >= SEARCH.maxSaved) throw new ApiError("BAD_REQUEST", `You can keep up to ${SEARCH.maxSaved} searches. Delete one first.`);
  try {
    return await createSavedSearch(db(), { id: newSavedSearchId(), accountId, query });
  } catch (error) {
    // Saved at the same moment from another tab: the same row.
    const saved = isUniqueViolation(error) ? await findSavedSearch(db(), accountId, query) : null;
    if (saved) return saved;
    throw error;
  }
}

export async function removeSavedSearch(accountId: string, id: string): Promise<void> {
  if ((await deleteSavedSearch(db(), accountId, id)) === 0) throw new ApiError("NOT_FOUND");
}
