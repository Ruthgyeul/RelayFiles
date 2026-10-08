import { z } from "zod";
import type { BusyBadge } from "@/domain/share";
import { FILES, SEARCH } from "@/config/policy";

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
  /** Files inside, recursively (1 for a file). */
  fileCount: number;
  tags: string[];
  linkId: string;
  hasThumb: boolean;
  settings: NodeSettingsDto;
  /** Share-link download congestion (design `busyShow`): "Busy", "Server busy" or paused. */
  busy: BusyBadge | null;
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
  /** Visibility this folder would inherit (its parent's; private for the root). */
  parentVisibility: "private" | "public";
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
  /** The folder it is in, to open it there. */
  parentId: string;
  parentIsRoot: boolean;
}

export const nodeIdSchema = z.string().regex(/^[a-z0-9]{12}$/);

/** "root" or a node id. */
export const folderRefSchema = z.union([z.literal("root"), nodeIdSchema]);

export const tagSearchSchema = z.object({
  tags: z
    .string()
    .transform((value) => value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string().max(24)).min(1).max(10)),
});

/** Global search query (empty = recent files). */
export const globalSearchSchema = z.object({ q: z.string().max(SEARCH.maxQueryLength) });

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

const nodeIds = z.array(nodeIdSchema).min(1).max(FILES.maxBatchItems);

/** `?ids=a,b,c` on download URLs (zip). */
export const idsQuerySchema = z
  .string()
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(nodeIds);

export const renameSchema = z.object({ name: z.string().max(1024) });

export const moveSchema = z.object({ ids: nodeIds, targetId: folderRefSchema, mode: z.enum(["move", "copy"]) });

export const deleteSchema = z.object({ ids: nodeIds });

export const tagsSchema = z.object({
  ids: nodeIds,
  add: z.array(z.string().max(64)).max(50).default([]),
  remove: z.array(z.string().max(64)).max(50).default([]),
});

export const settingsSchema = z.object({
  visibility: z.enum(["inherit", "private", "public"]),
  /** Admins only; ignored for members (their items are deleted with the account). */
  expiry: z.string().max(16),
  burn: z.boolean(),
  downloadLimit: z.number().int().positive().max(1_000_000).nullable(),
  /** undefined = keep, "" = remove, otherwise the new password. */
  password: z.string().max(128).optional(),
  access: z.enum(["both", "stream"]),
  note: z.string().max(2_000),
  /** Folders: reset the visibility of everything inside to "inherit". */
  applyDown: z.boolean().default(false),
});

export const pauseSchema = z.object({ paused: z.boolean() });

export type SettingsInput = z.infer<typeof settingsSchema>;

/** Result of a move or copy. */
export interface TransferResult {
  done: number;
  /** Items renamed to avoid a name clash in the target folder. */
  renamed: number;
  targetName: string;
}

/** A folder in the move/copy picker tree. */
export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

export type LinkEventKind = "open" | "play" | "view" | "download" | "reset";

/** One entry of the link activity log. */
export interface LinkEventDto {
  kind: LinkEventKind;
  fileName: string;
  device: string;
  ipMasked: string;
  country: string;
  at: string;
}
