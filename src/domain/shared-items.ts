/**
 * "Shared by me": which items of an account can be opened from outside, and the filter chips of
 * the list. An item public only because a folder above it is public is not listed on its own:
 * that folder's row stands for it.
 */
import type { Visibility } from "./tree";

export interface ShareFolder {
  parentId: string | null;
  visibility: Visibility;
}

/** Visibility in effect for items directly inside `folderId` (private above the root). */
export function visibilityInside(folderId: string | null, folders: ReadonlyMap<string, ShareFolder>): "private" | "public" {
  // A folder chain is finite and acyclic (the database keeps it a tree); the guard only stops bad data.
  for (let id = folderId, steps = 0; id !== null && steps <= folders.size; steps++) {
    const folder = folders.get(id);
    if (!folder) break;
    if (folder.visibility !== "inherit") return folder.visibility;
    id = folder.parentId;
  }
  return "private";
}

export interface ShareCandidate {
  visibility: Visibility;
  /** It has its own password, download limit, expiry, first-download delete or paused downloads. */
  restricted: boolean;
}

/** Listed: the top of a public part of the tree, or a public item with limits of its own. */
export function isListedShare(item: ShareCandidate, parentEffective: "private" | "public"): boolean {
  const effective = item.visibility === "inherit" ? parentEffective : item.visibility;
  if (effective !== "public") return false;
  return (item.visibility === "public" && parentEffective === "private") || item.restricted;
}

export const SHARED_FILTERS = ["all", "password", "limited", "expiring", "paused"] as const;
export type SharedFilter = (typeof SHARED_FILTERS)[number];

export const SHARED_FILTER_LABEL: Record<SharedFilter, string> = { all: "All", password: "Password", limited: "Limited", expiring: "Expiring", paused: "Paused" };

export interface SharedFilterSettings {
  hasPassword: boolean;
  downloadLimit: number | null;
  burn: boolean;
  expAt: string | null;
  dlPaused: boolean;
}

/** True when an item's settings match a filter chip. */
export function matchesSharedFilter(settings: SharedFilterSettings, filter: SharedFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "password":
      return settings.hasPassword;
    case "limited":
      return settings.downloadLimit !== null || settings.burn;
    case "expiring":
      return settings.expAt !== null;
    case "paused":
      return settings.dlPaused;
  }
}
