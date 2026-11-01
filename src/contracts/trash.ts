import { z } from "zod";
import { ID_PATTERN } from "@/domain/ids";
import type { NodeKind, NodeType } from "./nodes";

/** `:id` of /api/trash/:id. */
export const deletedItemIdSchema = z.string().regex(ID_PATTERN.deletedItem);

/** GET /api/trash: an item under "Recently deleted", newest first. */
export interface DeletedItemDto {
  id: string;
  name: string;
  type: NodeType;
  kind: NodeKind | null;
  /** Bytes of every file in it, as a decimal string. */
  size: string;
  /** Files and folders it held, itself included. */
  itemCount: number;
  deletedAt: string;
  /** When it is removed for good at the earliest (the daily cleanup's first run after this). */
  expiresAt: string;
  /** Folder names from the account root down to the folder it was in when it was deleted. */
  location: string[];
}

/** POST /api/trash/:id/restore: where the item went. */
export interface RestoredItem {
  /** The name it got back ("Report (2).pdf" when the old one was taken). */
  name: string;
  renamed: boolean;
  /** The folder it is in now: its old folder, or the account root when that is gone. */
  folderId: string;
  folderName: string;
  folderIsRoot: boolean;
  /** False when its old folder was deleted, so it went into the account root. */
  inOriginalFolder: boolean;
}
