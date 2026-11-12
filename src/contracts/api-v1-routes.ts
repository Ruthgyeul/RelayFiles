import { z } from "zod";
import { SEARCH } from "@/config/policy";
import { MAX_NAME_BYTES } from "@/domain/names";
import { apiV1NodePatchSchema, apiV1SharePatchSchema, type ApiScope } from "./api-tokens";
import { apiV1AccountSchema, apiV1ShareSchema, apiV1UploadedFileSchema, createdFolderSchema, deletedCountSchema, favoritesViewSchema, folderViewSchema, nodeItemSchema, taggedItemSchema } from "./api-v1";
import { createFolderSchema } from "./nodes";

export type ApiV1Method = "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";

/** One /api/v1 endpoint as the OpenAPI document describes it (scripts/openapi.mts). */
export interface ApiV1Route {
  method: ApiV1Method;
  /** OpenAPI path with `{param}` placeholders, e.g. /api/v1/files/{id}. */
  path: string;
  /** Scope the token needs; null: any valid token. */
  scope: ApiScope | null;
  summary: string;
  description?: string;
  params?: Record<string, string>;
  query?: z.ZodObject;
  /** A JSON body, or "binary" for the raw bytes of a file. */
  body?: z.ZodType | "binary";
  /** The `data` of a `{ success: true, data }` answer, or "file" for raw bytes. */
  response: z.ZodType | "file";
  status: 200 | 201;
}

const nodeId = "Item id (12 characters)";
const folderRef = '"root" or a folder id';

/**
 * Every /api/v1 endpoint. api-v1-routes.test.ts checks that each method exported by a route
 * file under src/app/api/v1 is listed here, so a new endpoint cannot be left undocumented.
 */
export const API_V1_ROUTES: readonly ApiV1Route[] = [
  { method: "GET", path: "/api/v1/me", scope: null, summary: "The token's account, its storage use and the token's scopes", response: apiV1AccountSchema, status: 200 },
  { method: "GET", path: "/api/v1/folders/{id}", scope: "files:read", summary: "A folder with its path and children", params: { id: folderRef }, response: folderViewSchema, status: 200 },
  { method: "POST", path: "/api/v1/folders", scope: "files:write", summary: "Create a folder", description: 'A name already taken becomes "Name (2)" (`renamed: true`).', body: createFolderSchema, response: createdFolderSchema, status: 201 },
  {
    method: "POST",
    path: "/api/v1/files",
    scope: "files:write",
    summary: "Upload one file as the request body",
    description: "Send the bytes as the body with Content-Length (curl --data-binary @file). A taken name is kept as both (\"name (2).ext\").",
    query: z.object({ folder: z.string().default("root").describe(folderRef), name: z.string().min(1).max(MAX_NAME_BYTES).describe("File name") }),
    body: "binary",
    response: apiV1UploadedFileSchema,
    status: 201,
  },
  { method: "GET", path: "/api/v1/files/{id}", scope: "files:read", summary: "Download a file (Range and ETag supported)", params: { id: nodeId }, response: "file", status: 200 },
  { method: "HEAD", path: "/api/v1/files/{id}", scope: "files:read", summary: "A download's headers without the bytes", params: { id: nodeId }, response: "file", status: 200 },
  {
    method: "PATCH",
    path: "/api/v1/nodes/{id}",
    scope: "files:write",
    summary: "Rename, move and/or favorite a file or folder",
    description: "A name taken where it ends up answers 409. `favorite: true` lists the item at the top of Favorites (more than FILES.maxFavorites answers 400).",
    params: { id: nodeId },
    body: apiV1NodePatchSchema,
    response: nodeItemSchema,
    status: 200,
  },
  { method: "DELETE", path: "/api/v1/nodes/{id}", scope: "files:write", summary: "Delete a file or a folder with everything inside", params: { id: nodeId }, response: deletedCountSchema, status: 200 },
  { method: "GET", path: "/api/v1/nodes/{id}/share", scope: "files:read", summary: "An item's share link and settings", params: { id: nodeId }, response: apiV1ShareSchema, status: 200 },
  {
    method: "PATCH",
    path: "/api/v1/nodes/{id}/share",
    scope: "files:write",
    summary: "Change share settings",
    description: "Only the fields sent change. `password`: a string sets it, null or \"\" removes it. `expiry` and `burn` are for admins (403 otherwise).",
    params: { id: nodeId },
    body: apiV1SharePatchSchema,
    response: apiV1ShareSchema,
    status: 200,
  },
  { method: "POST", path: "/api/v1/nodes/{id}/link", scope: "files:write", summary: "Replace an item's share link (the old one stops working at once)", params: { id: nodeId }, response: apiV1ShareSchema, status: 200 },
  {
    method: "GET",
    path: "/api/v1/favorites",
    scope: "files:read",
    summary: "One level of Favorites",
    description: "Favorites list items where they are (no copies). Without `folder`, the top; organizing folders are made in the web app.",
    query: z.object({ folder: z.string().optional().describe("Organizing folder id") }),
    response: favoritesViewSchema,
    status: 200,
  },
  {
    method: "GET",
    path: "/api/v1/search",
    scope: "files:read",
    summary: "Search the account",
    description: "`q`: recent files when empty, items with every `#tag`, or names. Without `q`, `tags=a,b` lists every item carrying all the tags.",
    query: z.object({ q: z.string().max(SEARCH.maxQueryLength).optional(), tags: z.string().optional().describe("Comma-separated tags") }),
    response: z.array(taggedItemSchema),
    status: 200,
  },
];
