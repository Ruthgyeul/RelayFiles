import { uniqName } from "./names";
import { SORT_KEYS, SORT_OPTION_LABEL, SORT_SHORT_LABEL, sortNodes, type FilterKey, type SortableNode, type SortKey } from "./tree";

/** An organizing folder inside Favorites (null parent: directly inside Favorites). */
export interface FavoriteFolderLink {
  id: string;
  parentId: string | null;
  name: string;
}

type Tree = ReadonlyMap<string, FavoriteFolderLink>;

export function favoriteTree(folders: readonly FavoriteFolderLink[]): Map<string, FavoriteFolderLink> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

/** Folders from the top of Favorites down to `id` (inclusive); empty for null or an unknown id. */
export function favoritePath(tree: Tree, id: string | null): FavoriteFolderLink[] {
  const path: FavoriteFolderLink[] = [];
  const seen = new Set<string>();
  for (let folder = id ? tree.get(id) : undefined; folder && !seen.has(folder.id); folder = folder.parentId ? tree.get(folder.parentId) : undefined) {
    seen.add(folder.id);
    path.unshift(folder);
  }
  return path;
}

/** Depth of a folder: 1 directly inside Favorites, 0 for Favorites itself (null). */
export function favoriteDepth(tree: Tree, id: string | null): number {
  return favoritePath(tree, id).length;
}

/** `id` and every folder below it. */
export function favoriteSubtree(tree: Tree, id: string): string[] {
  const below = new Map<string | null, string[]>();
  for (const folder of tree.values()) below.set(folder.parentId, [...(below.get(folder.parentId) ?? []), folder.id]);
  const out: string[] = [];
  const walk = (current: string) => {
    out.push(current);
    for (const child of below.get(current) ?? []) walk(child);
  };
  walk(id);
  return out;
}

/** Levels below `id` (0 for a folder without subfolders). */
export function favoriteHeight(tree: Tree, id: string): number {
  const children = [...tree.values()].filter((folder) => folder.parentId === id);
  return children.length === 0 ? 0 : 1 + Math.max(...children.map((child) => favoriteHeight(tree, child.id)));
}

/** Moving `id` into `target` would put a folder inside itself. */
export function wouldCycle(tree: Tree, id: string, target: string | null): boolean {
  return favoritePath(tree, target).some((folder) => folder.id === id);
}

/** Whether `id` (with everything below it) fits under `target` within `maxDepth` levels. */
export function fitsDepth(tree: Tree, id: string, target: string | null, maxDepth: number): boolean {
  return favoriteDepth(tree, target) + 1 + favoriteHeight(tree, id) <= maxDepth;
}

/**
 * New names for folders lifted next to `siblings` when their parent is deleted ("Move them up"):
 * a taken name becomes "Name (2)", the way uploads and new folders avoid clashes.
 */
export function liftedNames(siblings: readonly string[], moving: readonly FavoriteFolderLink[]): Map<string, string> {
  const taken = new Set(siblings);
  const names = new Map<string, string>();
  for (const folder of moving) {
    const name = uniqName(taken, folder.name, false);
    taken.add(name);
    names.set(folder.id, name);
  }
  return names;
}

/** Favorites sort: "added" keeps the order they were added in (newest first), then the File Manager's keys. */
export const FAVORITE_SORT_KEYS = ["added", ...SORT_KEYS] as const;
export type FavoriteSortKey = (typeof FAVORITE_SORT_KEYS)[number];

export const FAVORITE_SORT_OPTION_LABEL: Record<FavoriteSortKey, string> = { added: "Recently added", ...SORT_OPTION_LABEL };
export const FAVORITE_SORT_SHORT_LABEL: Record<FavoriteSortKey, string> = { added: "Added", ...SORT_SHORT_LABEL };

/** Favorites in the chosen order; "added" keeps `list` as given (the server lists newest favorite first). */
export function sortFavorites<T extends SortableNode>(list: readonly T[], key: FavoriteSortKey): T[] {
  return key === "added" ? [...list] : sortNodes(list, key satisfies SortKey);
}

interface FolderListing {
  /** Lowercased, trimmed name query ("" for none). */
  query: string;
  filter: FilterKey;
  /** Tag search lists favorites from every organizing folder, so no folders are shown. */
  tagMode: boolean;
  sort: FavoriteSortKey;
}

/**
 * Organizing folders shown above the favorites: hidden during tag search and for file-type
 * filters, matched by name, in name order (reversed only for "Name Z → A").
 */
export function visibleFavoriteFolders<T extends { name: string }>(folders: readonly T[], { query, filter, tagMode, sort }: FolderListing): T[] {
  if (tagMode || (filter !== "all" && filter !== "folder")) return [];
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });
  return folders.filter((folder) => !query || folder.name.toLowerCase().includes(query)).sort(sort === "name-desc" ? (a, b) => byName(b, a) : byName);
}
