import "server-only";
import { FILES } from "@/config/policy";
import type { FavoriteFolderDeleteMode, FavoriteFolderDto, FavoriteFolderPage, FavoritesView } from "@/contracts/favorites";
import { favoriteDepth, favoritePath, favoriteSubtree, favoriteTree, fitsDepth, liftedNames, wouldCycle, type FavoriteFolderLink } from "@/domain/favorites";
import { newNodeId } from "@/domain/ids";
import { nameError } from "@/domain/names";
import { db, type DbClient } from "../db/client";
import { ApiError } from "../http/api-error";
import {
  addFavorites as insertFavorites,
  countFavorites,
  countFavoritesIn,
  createFavoriteFolder as insertFavoriteFolder,
  deleteFavoriteFolders,
  favoriteFolderCounts,
  favoriteFoldersOf,
  favoritesIn,
  listFavoriteFolders,
  lockFavoritesOf,
  moveFavorites,
  moveFavoritesOutOf,
  removeFavorites as deleteFavorites,
  removeFavoritesIn,
  updateFavoriteFolder,
} from "../repositories/favorite.repo";
import { findNode, findNodes } from "../repositories/node.repo";
import { getFolderView, withPaths } from "./node.service";

/** The account Favorites belong to. */
interface FavoritesOwner {
  id: string;
}

type Tree = Map<string, FavoriteFolderLink>;

/** Runs a change with the account's Favorites locked and its organizing folders loaded. */
function changeFavorites<T>(accountId: string, change: (tx: DbClient, tree: Tree) => Promise<T>): Promise<T> {
  return db().$transaction(async (tx) => {
    await lockFavoritesOf(tx, accountId);
    return change(tx, favoriteTree(await listFavoriteFolders(tx, accountId)));
  });
}

function requireGroup(tree: Tree, id: string | null): void {
  if (id !== null && !tree.has(id)) throw new ApiError("NOT_FOUND");
}

function validName(raw: string): string {
  const name = raw.trim();
  const error = nameError(name);
  if (error) throw new ApiError("BAD_REQUEST", error, { fields: { name: error } });
  return name;
}

function assertFreeName(tree: Tree, parentId: string | null, name: string, except?: string): void {
  for (const folder of tree.values()) if (folder.parentId === parentId && folder.id !== except && folder.name === name) throw new ApiError("CONFLICT", `"${name}" already exists here.`);
}

const tooDeep = () => new ApiError("BAD_REQUEST", `Folders in Favorites can be at most ${FILES.favoriteFolderMaxDepth} levels deep.`);

/**
 * Adds items to Favorites (in `folderId`, null: the top). Items already there stay where they
 * are. The account root cannot be added; another account's item is 404.
 */
export async function addFavorites(owner: FavoritesOwner, nodeIds: string[], folderId: string | null): Promise<{ added: number }> {
  const ids = [...new Set(nodeIds)];
  return changeFavorites(owner.id, async (tx, tree) => {
    requireGroup(tree, folderId);
    const rows = await findNodes(tx, owner.id, ids);
    if (rows.length !== ids.length) throw new ApiError("NOT_FOUND");
    if (rows.some((row) => row.parentId === null)) throw new ApiError("BAD_REQUEST", "The root folder can't be a favorite.");
    const already = await favoriteFoldersOf(tx, ids);
    const adding = ids.filter((id) => !already.has(id));
    if ((await countFavorites(tx, owner.id)) + adding.length > FILES.maxFavorites) {
      throw new ApiError("BAD_REQUEST", `You can keep at most ${FILES.maxFavorites} favorites. Remove one first.`);
    }
    const { count } = await insertFavorites(tx, adding.map((nodeId) => ({ id: newNodeId(), accountId: owner.id, nodeId, folderId })));
    return { added: count };
  });
}

/** Takes items out of Favorites; the items themselves stay where they are. */
export async function removeFavorites(owner: FavoritesOwner, nodeIds: string[]): Promise<{ removed: number }> {
  const { count } = await deleteFavorites(db(), owner.id, [...new Set(nodeIds)]);
  return { removed: count };
}

export async function createFavoriteFolder(owner: FavoritesOwner, parentId: string | null, rawName: string): Promise<FavoriteFolderDto> {
  const name = validName(rawName);
  return changeFavorites(owner.id, async (tx, tree) => {
    requireGroup(tree, parentId);
    if (tree.size >= FILES.maxFavoriteFolders) throw new ApiError("BAD_REQUEST", `Favorites can hold at most ${FILES.maxFavoriteFolders} folders.`);
    if (favoriteDepth(tree, parentId) + 1 > FILES.favoriteFolderMaxDepth) throw tooDeep();
    assertFreeName(tree, parentId, name);
    const folder = await insertFavoriteFolder(tx, { id: newNodeId(), accountId: owner.id, parentId, name });
    return { ...folder, itemCount: 0 };
  });
}

export async function renameFavoriteFolder(owner: FavoritesOwner, id: string, rawName: string): Promise<{ id: string; name: string }> {
  const name = validName(rawName);
  return changeFavorites(owner.id, async (tx, tree) => {
    const folder = tree.get(id);
    if (!folder) throw new ApiError("NOT_FOUND");
    assertFreeName(tree, folder.parentId, name, id);
    await updateFavoriteFolder(tx, owner.id, id, { name });
    return { id, name };
  });
}

/** Moves favorites and organizing folders to another organizing folder (null: the top). */
export async function moveInFavorites(owner: FavoritesOwner, input: { nodeIds: string[]; folderIds: string[]; to: string | null }): Promise<{ moved: number }> {
  const nodeIds = [...new Set(input.nodeIds)];
  const folderIds = [...new Set(input.folderIds)];
  return changeFavorites(owner.id, async (tx, tree) => {
    requireGroup(tree, input.to);
    for (const id of folderIds) {
      const folder = tree.get(id);
      if (!folder) throw new ApiError("NOT_FOUND");
      if (wouldCycle(tree, id, input.to)) throw new ApiError("BAD_REQUEST", "A folder can't be moved into itself.");
      if (!fitsDepth(tree, id, input.to, FILES.favoriteFolderMaxDepth)) throw tooDeep();
      assertFreeName(tree, input.to, folder.name, id);
      // Two moved folders with one name would clash with each other at the target too.
      tree.set(id, { ...folder, parentId: input.to });
    }
    const listed = await favoriteFoldersOf(tx, nodeIds);
    if (listed.size !== nodeIds.length) throw new ApiError("NOT_FOUND");
    for (const id of folderIds) await updateFavoriteFolder(tx, owner.id, id, { parentId: input.to });
    if (nodeIds.length > 0) await moveFavorites(tx, owner.id, nodeIds, input.to);
    return { moved: nodeIds.length + folderIds.length };
  });
}

/**
 * Deletes an organizing folder. "remove" takes the favorites inside it (and inside its
 * subfolders) out of Favorites; "lift" moves its favorites and subfolders up one level,
 * renaming subfolders whose names are taken there. Items themselves are never touched.
 */
export async function deleteFavoriteFolder(owner: FavoritesOwner, id: string, mode: FavoriteFolderDeleteMode): Promise<{ removedFavorites: number; movedUp: number }> {
  return changeFavorites(owner.id, async (tx, tree) => {
    const folder = tree.get(id);
    if (!folder) throw new ApiError("NOT_FOUND");
    if (mode === "remove") {
      const subtree = favoriteSubtree(tree, id);
      const { count } = await removeFavoritesIn(tx, owner.id, subtree);
      await deleteFavoriteFolders(tx, owner.id, [id]);
      return { removedFavorites: count, movedUp: 0 };
    }
    const children = [...tree.values()].filter((child) => child.parentId === id);
    const siblings = [...tree.values()].filter((other) => other.parentId === folder.parentId && other.id !== id).map((other) => other.name);
    const names = liftedNames(siblings, children);
    for (const child of children) await updateFavoriteFolder(tx, owner.id, child.id, { parentId: folder.parentId, name: names.get(child.id)! });
    const { count } = await moveFavoritesOutOf(tx, owner.id, id, folder.parentId);
    await deleteFavoriteFolders(tx, owner.id, [id]);
    return { removedFavorites: 0, movedUp: count + children.length };
  });
}

/**
 * Lists restored items in Favorites again where they were (the top when their organizing
 * folder is gone), as far as the account's favorites limit allows. Runs in the restore's
 * transaction; nothing here can fail the restore itself.
 */
export async function relistFavorites(tx: DbClient, accountId: string, entries: { nodeId: string; folderId: string | null }[]): Promise<void> {
  if (entries.length === 0) return;
  await lockFavoritesOf(tx, accountId);
  const tree = favoriteTree(await listFavoriteFolders(tx, accountId));
  const room = Math.max(0, FILES.maxFavorites - (await countFavorites(tx, accountId)));
  const rows = entries.slice(0, room).map(({ nodeId, folderId }) => ({ id: newNodeId(), accountId, nodeId, folderId: folderId && tree.has(folderId) ? folderId : null }));
  if (rows.length > 0) await insertFavorites(tx, rows);
}

/** Favorites inside a folder and its subfolders, for the delete dialog ("Removes 12 favorites"). */
export async function favoritesInside(owner: FavoritesOwner, id: string): Promise<number> {
  const tree = favoriteTree(await listFavoriteFolders(db(), owner.id));
  if (!tree.has(id)) throw new ApiError("NOT_FOUND");
  return countFavoritesIn(db(), owner.id, favoriteSubtree(tree, id));
}

/** One level of Favorites: its organizing folders and the items listed there. */
export async function favoritesView(owner: FavoritesOwner, folderId: string | null): Promise<FavoritesView> {
  const [folders, counts] = await Promise.all([listFavoriteFolders(db(), owner.id), favoriteFolderCounts(db(), owner.id)]);
  const tree = favoriteTree(folders);
  requireGroup(tree, folderId);
  const dto = (folder: FavoriteFolderLink): FavoriteFolderDto => ({ ...folder, itemCount: counts.get(folder.id) ?? 0 });
  const items = await withPaths(owner.id, await favoritesIn(db(), owner.id, folderId));
  return {
    folder: folderId ? dto(tree.get(folderId)!) : null,
    path: favoritePath(tree, folderId).map(({ id, name }) => ({ id, name })),
    folders: folders.filter((folder) => folder.parentId === folderId).map(dto),
    items,
    tree: folders,
  };
}

/**
 * A real folder opened from Favorites: `chain[0]` is a favorite folder and each next id a
 * folder directly inside the previous one. Anything else (not a favorite any more, not a
 * subfolder, another account's) is 404.
 */
export async function favoriteFolderPage(owner: FavoritesOwner, chain: string[]): Promise<FavoriteFolderPage> {
  const [first] = chain;
  if (!first) throw new ApiError("NOT_FOUND");
  const listed = await favoriteFoldersOf(db(), [first]);
  if (!listed.has(first)) throw new ApiError("NOT_FOUND");
  const rows = await Promise.all(chain.map((id) => findNode(db(), owner.id, id)));
  rows.forEach((row, index) => {
    if (!row || row.type !== "FOLDER" || (index > 0 && row.parentId !== chain[index - 1])) throw new ApiError("NOT_FOUND");
  });
  const tree = favoriteTree(await listFavoriteFolders(db(), owner.id));
  const view = await getFolderView(owner.id, chain[chain.length - 1]!);
  return {
    view,
    groups: favoritePath(tree, listed.get(first) ?? null).map(({ id, name }) => ({ id, name })),
    chain: rows.map((row) => ({ id: row!.id, name: row!.name })),
  };
}
