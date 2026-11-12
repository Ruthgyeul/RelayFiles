import { z } from "zod";
import { API_SCOPES } from "./api-tokens";

/**
 * Response bodies of /api/v1 as zod schemas, for the OpenAPI document (scripts/openapi.mts,
 * docs/openapi.json). The TypeScript types the app uses (NodeItem, FolderView, ApiV1Share, …)
 * stay where they are; api-v1.test.ts checks that each schema describes exactly its type, so
 * the document cannot drift from what the routes send.
 */

const isoTime = z.string().describe("ISO 8601 time");
const bytes = z.string().regex(/^\d+$/).describe("Bytes as a decimal string (may exceed 2^53)");
const visibility = z.enum(["inherit", "private", "public"]);
const effectiveVisibility = z.enum(["private", "public"]);

export const nodeSettingsSchema = z.object({
  visibility,
  expiry: z.string().describe('Expiry label ("Never", "7 days", …); set by admins only'),
  expAt: isoTime.nullable(),
  burn: z.boolean().describe("Deleted after its first download (admins only)"),
  downloadLimit: z.number().int().nullable(),
  hasPassword: z.boolean(),
  access: z.enum(["both", "stream"]),
  note: z.string(),
  dlPaused: z.boolean(),
});

export const busyBadgeSchema = z.object({ level: z.union([z.literal(1), z.literal(2)]), label: z.string(), tip: z.string() });

export const nodeItemSchema = z.object({
  id: z.string(),
  type: z.enum(["folder", "file"]),
  name: z.string(),
  kind: z.enum(["video", "audio", "image", "other"]).nullable(),
  size: bytes.describe("Bytes as a decimal string; folders carry the total of their contents"),
  createdAt: isoTime,
  modifiedAt: isoTime.optional().describe("Files: when the content last changed"),
  downloads: z.number().int(),
  itemCount: z.number().int().describe("Direct children (folders)"),
  fileCount: z.number().int().describe("Files inside, recursively (1 for a file)"),
  tags: z.array(z.string()),
  linkId: z.string(),
  hasThumb: z.boolean(),
  settings: nodeSettingsSchema,
  busy: busyBadgeSchema.nullable(),
  favorite: z.literal(true).optional().describe("Listed in Favorites"),
});

export const folderViewSchema = z.object({
  folder: nodeItemSchema,
  isRoot: z.boolean(),
  path: z.array(z.object({ id: z.string(), name: z.string() })).describe("From the root down to this folder"),
  effectiveVisibility,
  parentVisibility: effectiveVisibility,
  children: z.array(nodeItemSchema),
  favoriteCount: z.number().int().optional().describe("The root only: items in Favorites"),
});

export const createdFolderSchema = z.object({ folder: nodeItemSchema, requestedName: z.string(), renamed: z.boolean() });

export const taggedItemSchema = nodeItemSchema.extend({ parentPath: z.string(), parentId: z.string(), parentIsRoot: z.boolean() });

export const apiV1AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
  quotaBytes: bytes.nullable().describe("Null: no account limit"),
  usedBytes: bytes,
  scopes: z.array(z.enum(API_SCOPES)),
});

export const apiV1UploadedFileSchema = z.object({ nodeId: z.string(), name: z.string(), folderId: z.string(), linkId: z.string(), url: z.string() });

export const apiV1ShareSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["file", "folder"]),
  linkId: z.string(),
  url: z.string(),
  visibility,
  effectiveVisibility,
  access: z.enum(["both", "stream"]),
  downloadLimit: z.number().int().nullable(),
  downloads: z.number().int(),
  note: z.string(),
  hasPassword: z.boolean(),
  expiry: z.string(),
  expAt: isoTime.nullable(),
  burn: z.boolean(),
});

export const deletedCountSchema = z.object({ deleted: z.number().int() });

const favoriteFolderSchema = z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable(), itemCount: z.number().int().describe("Favorites and folders directly inside") });

export const favoritesViewSchema = z.object({
  folder: favoriteFolderSchema.nullable().describe("The organizing folder shown; null for the top of Favorites"),
  path: z.array(z.object({ id: z.string(), name: z.string() })).describe("Organizing folders from the top of Favorites down to this one"),
  folders: z.array(favoriteFolderSchema),
  items: z.array(taggedItemSchema).describe("Items listed here, newest favorite first; parentPath is where they really are"),
  tree: z.array(z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() })).describe("Every organizing folder"),
});
