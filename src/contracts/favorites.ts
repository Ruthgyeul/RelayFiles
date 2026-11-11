import { z } from "zod";
import { FILES } from "@/config/policy";
import { nodeIdSchema, type FolderCrumb, type FolderView, type TaggedItem } from "./nodes";

/**
 * Favorites: a virtual folder at the top of the File Manager that lists items where they are
 * (no copies), with organizing folders of its own (docs/architecture.md "즐겨찾기").
 */

/** An organizing folder inside Favorites. */
export interface FavoriteFolderDto {
  id: string;
  name: string;
  parentId: string | null;
  /** Favorites and folders directly inside. */
  itemCount: number;
}

/** GET /api/favorites?folder= — one level of Favorites. */
export interface FavoritesView {
  /** The organizing folder shown; null for the top of Favorites. */
  folder: FavoriteFolderDto | null;
  /** Organizing folders from the top of Favorites down to this one. */
  path: FolderCrumb[];
  folders: FavoriteFolderDto[];
  /** Items listed here, newest favorite first, with where they really are (parentPath). */
  items: TaggedItem[];
  /** Every organizing folder, for the "Move in favorites" picker. */
  tree: { id: string; name: string; parentId: string | null }[];
}

/** A real folder opened from Favorites: the usual folder view and how it was reached. */
export interface FavoriteFolderPage {
  view: FolderView;
  /** Organizing folders above the favorite. */
  groups: FolderCrumb[];
  /** The favorite folder and the folders opened below it. */
  chain: FolderCrumb[];
}

const nodeIds = z.array(nodeIdSchema).max(FILES.maxBatchItems);
const favoriteFolderId = nodeIdSchema.nullable();

export const addFavoritesSchema = z.object({ nodeIds: nodeIds.min(1), folderId: favoriteFolderId.default(null) });
export const removeFavoritesSchema = z.object({ nodeIds: nodeIds.min(1) });
export const favoriteFolderQuerySchema = z.object({ folder: nodeIdSchema.optional() });

export const createFavoriteFolderSchema = z.object({ parentId: favoriteFolderId, name: z.string().max(1024) });
export const renameFavoriteFolderSchema = z.object({ name: z.string().max(1024) });

export const moveFavoritesSchema = z
  .object({ nodeIds: nodeIds.default([]), folderIds: z.array(nodeIdSchema).max(FILES.maxFavoriteFolders).default([]), to: favoriteFolderId })
  .refine((input) => input.nodeIds.length + input.folderIds.length > 0, "Choose something to move.");

/** Deleting an organizing folder: drop the favorites inside, or move them (and subfolders) up a level. */
export const FAVORITE_FOLDER_DELETE_MODES = ["remove", "lift"] as const;
export type FavoriteFolderDeleteMode = (typeof FAVORITE_FOLDER_DELETE_MODES)[number];
export const deleteFavoriteFolderQuerySchema = z.object({ mode: z.enum(FAVORITE_FOLDER_DELETE_MODES) });
