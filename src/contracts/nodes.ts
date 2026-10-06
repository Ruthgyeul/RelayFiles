import { z } from "zod";

export type NodeKind = "video" | "audio" | "image" | "other";
export type NodeType = "folder" | "file";
export type Visibility = "inherit" | "private" | "public";

/** Share settings of a file or folder (the password itself never leaves the server). */
export interface NodeSettingsDto {
  visibility: Visibility;
  expiry: string;
  /** ISO time the item is deleted, if it has an expiry. */
  expAt: string | null;
  burn: boolean;
  downloadLimit: number | null;
  hasPassword: boolean;
  access: "both" | "stream";
  note: string;
  dlPaused: boolean;
}

/** A file or folder as listed in the File Manager. */
export interface NodeItem {
  id: string;
  type: NodeType;
  name: string;
  kind: NodeKind | null;
  /** Bytes as a decimal string; folders carry the total of their contents. */
  size: string;
  createdAt: string;
  downloads: number;
  /** Direct children (folders only). */
  itemCount: number;
  tags: string[];
  linkId: string;
  hasThumb: boolean;
  settings: NodeSettingsDto;
}

export interface FolderCrumb {
  id: string;
  name: string;
}

/** GET /api/folders/:id — a folder, its path and its children. */
export interface FolderView {
  folder: NodeItem;
  isRoot: boolean;
  /** From the root down to (and including) this folder. */
  path: FolderCrumb[];
  /** Visibility in effect for this folder (inherited or its own). */
  effectiveVisibility: "private" | "public";
  children: NodeItem[];
}

/** GET /api/nodes/:id — details for the Properties dialog. */
export interface NodeProperties {
  item: NodeItem;
  isRoot: boolean;
  /** Folder names from the root to the parent ("root / Videos"); empty for the root. */
  location: string[];
  effectiveVisibility: "private" | "public";
  /** Files and folders anywhere inside (folders only). */
  contains: { files: number; folders: number } | null;
}

/** A tag search hit, with its folder path for context ("Videos / 2024"). */
export interface TaggedItem extends NodeItem {
  parentPath: string;
}

export const nodeIdSchema = z.string().regex(/^[a-z0-9]{12}$/);

/** "root" or a node id. */
export const folderRefSchema = z.union([z.literal("root"), z.string().regex(/^[a-z0-9]{12}$/)]);

export const tagSearchSchema = z.object({
  tags: z
    .string()
    .transform((value) => value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string().max(24)).min(1).max(10)),
});

export const createFolderSchema = z.object({
  parentId: folderRefSchema,
  name: z.string().max(1024),
});

/** Result of creating a folder; `renamed` is true when the requested name was taken. */
export interface CreatedFolder {
  folder: NodeItem;
  requestedName: string;
  renamed: boolean;
}
