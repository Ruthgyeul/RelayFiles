import { limitHit } from "./share";

/** The download limit settings of an item in a share link. */
export interface LimitFacts {
  id: string;
  burn: boolean;
  downloadLimit: number | null;
  downloads: number;
}

/** Whether an item limits its downloads itself: a download limit, or delete after the first download. */
export const limitsDownloads = (row: Pick<LimitFacts, "burn" | "downloadLimit">): boolean => row.burn || (row.downloadLimit !== null && row.downloadLimit > 0);

/** Whether an item that limits downloads has none left (its limit reached, or deleted after its first). */
export const downloadsUsedUp = (row: LimitFacts): boolean => limitHit(row.downloadLimit, row.downloads) || (row.burn && row.downloads >= 1);

/**
 * What a download that was just counted (`downloads` already includes it) used up: the item's
 * download limit, its single download before deletion, or nothing. Only the download that
 * reaches the limit answers, so each item is reported once.
 */
export function ranOutWith(row: Omit<LimitFacts, "id">): "limit" | "burn" | null {
  if (row.burn) return row.downloads === 1 ? "burn" : null;
  return row.downloadLimit !== null && row.downloadLimit > 0 && row.downloads === row.downloadLimit ? "limit" : null;
}

/** The items among `rows` that limit downloads themselves (counted with every download below them). */
export const limitingIds = (rows: readonly Pick<LimitFacts, "id" | "burn" | "downloadLimit">[]): string[] => rows.filter(limitsDownloads).map((row) => row.id);

/** A row of a folder tree read from its top down (`parentId` links). */
export interface TreeLimitRow extends LimitFacts {
  parentId: string | null;
}

/**
 * For each row below `topId`, the folders strictly between `topId` and it that limit downloads
 * (nearest first). "Download all" of `topId` counts and checks those folders for every file it
 * includes, as a single download of the file through `topId` would: `topId` and the folders
 * above it are counted once for the whole zip by the caller.
 */
export function limitingFoldersBelow(rows: readonly TreeLimitRow[], topId: string): Map<string, TreeLimitRow[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const known = new Map<string, TreeLimitRow[]>([[topId, []]]);
  const below = (row: TreeLimitRow): TreeLimitRow[] => {
    const cached = known.get(row.id);
    if (cached) return cached;
    const parent = byId.get(row.parentId ?? "");
    // A row whose parent is not in the tree is directly below the top (or outside it).
    const way = parent && parent.id !== topId ? [...(limitsDownloads(parent) ? [parent] : []), ...below(parent)] : [];
    known.set(row.id, way);
    return way;
  };
  for (const row of rows) if (row.id !== topId) below(row);
  known.delete(topId);
  return known;
}
