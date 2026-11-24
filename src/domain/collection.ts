/**
 * Collection links: several of an account's files and folders behind one link with settings of
 * its own. Each item stays guarded by its own settings and those of the folders above it.
 */

/** The settings of one item on the way from the account root down to a collection item. */
export interface CollectionGuardRow {
  id: string;
  hasPassword: boolean;
  /** Epoch ms when the item expires (it is deleted then), if it does. */
  expAt: number | null;
  burn: boolean;
  downloads: number;
}

/**
 * Where a collection item starts on a chain (account root first): the lowest row that is one of
 * the collection's items (an item inside another is checked as itself, as it is listed), or -1
 * when the chain does not pass through any of them.
 */
export function collectionItemIndex(chain: readonly Pick<CollectionGuardRow, "id">[], items: ReadonlySet<string>): number {
  return chain.findLastIndex((row) => items.has(row.id));
}

/**
 * Whether a collection shows an item, from the rows from the account root down to the item: an
 * item behind a password (its own or a folder's above it, which only that item's own link can
 * ask for), past its expiry, or under a used delete-after-download item is left out.
 */
export function collectionItemOpen(path: readonly CollectionGuardRow[], now: number): boolean {
  return path.every((row) => !row.hasPassword && (row.expAt === null || row.expAt > now) && !(row.burn && row.downloads >= 1));
}

/** A new collection's suggested name: the item's name, or the first one's and how many more. */
export function collectionNameFor(names: readonly string[]): string {
  const [first = "Shared items", ...rest] = names;
  return rest.length === 0 ? first : `${first} + ${rest.length} more`;
}
