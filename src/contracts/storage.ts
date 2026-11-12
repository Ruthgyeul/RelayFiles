import type { StorageBar } from "@/domain/storage-view";
import type { TaggedItem } from "./nodes";

/** GET /api/me/storage: where the account's space goes (Storage page). */
export interface StorageOverview {
  /** File bytes in the tree, trash bytes waiting to be removed (both count toward the limit). */
  usedBytes: string;
  trashBytes: string;
  quotaBytes: string | null;
  /** What each item at the top of the root holds, largest first. */
  bars: StorageBar[];
  largest: TaggedItem[];
  /** Old files without share-link activity since STORAGE_VIEW.staleAfterDays. */
  stale: TaggedItem[];
  staleAfterDays: number;
}
