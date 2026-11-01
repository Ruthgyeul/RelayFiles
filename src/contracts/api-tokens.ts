import { z } from "zod";
import { API } from "@/config/policy";
import { MAX_NAME_BYTES } from "@/domain/names";
import { folderRefSchema, renameSchema, settingsSchema, type NodeSettingsDto } from "./nodes";
import type { UploadedFile } from "./uploads";

/**
 * What a personal API token may do. `metrics:read` (Prometheus /metrics) is offered to admins
 * only; the others act on the token owner's own files.
 */
export const API_SCOPES = ["files:read", "files:write", "metrics:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const ADMIN_ONLY_SCOPES: readonly ApiScope[] = ["metrics:read"];

export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  "files:read": "Read files and folders",
  "files:write": "Upload, rename, move, share and delete",
  "metrics:read": "Server metrics (admins)",
};

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(API.nameMaxLength),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
  /** One of API.expiryDays, or null for a token that lasts until revoked. */
  expiresInDays: z
    .number()
    .int()
    .refine((days) => (API.expiryDays as readonly number[]).includes(days), "Unknown lifetime.")
    .nullable(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export interface ApiTokenDto {
  id: string;
  name: string;
  scopes: ApiScope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

/** The new token in full: shown once, never again. */
export interface CreatedApiToken {
  token: string;
  item: ApiTokenDto;
}

/** `POST /api/v1/files?folder=<root|id>&name=<file name>`; the body is the file. */
export const apiV1UploadQuerySchema = z.object({
  folder: folderRefSchema.default("root"),
  name: z.string().min(1).max(MAX_NAME_BYTES),
});

/** GET /api/v1/me */
export interface ApiV1Account {
  id: string;
  name: string;
  isAdmin: boolean;
  /** Bytes as decimal strings; null quota means no account limit. */
  quotaBytes: string | null;
  usedBytes: string;
  scopes: ApiScope[];
}

/** POST /api/v1/files: the stored file and its share link (subject to its sharing settings). */
export interface ApiV1UploadedFile extends UploadedFile {
  linkId: string;
  url: string;
}

/** PATCH /api/v1/nodes/:id: rename, move into another folder ("root" or an id), or both. */
export const apiV1NodePatchSchema = z
  .object({ name: renameSchema.shape.name.optional(), parentId: folderRefSchema.optional() })
  .refine((input) => input.name !== undefined || input.parentId !== undefined, "Send a name, a parentId or both.");

export type ApiV1NodePatch = z.infer<typeof apiV1NodePatchSchema>;

const share = settingsSchema.shape;

/**
 * PATCH /api/v1/nodes/:id/share: only the fields sent change. `password`: a string sets it,
 * null or "" removes it. `expiry` and `burn` are for admins (403 otherwise), like the web app.
 */
export const apiV1SharePatchSchema = z
  .object({
    visibility: share.visibility.optional(),
    access: share.access.optional(),
    downloadLimit: share.downloadLimit.optional(),
    note: share.note.optional(),
    password: share.password.unwrap().nullable().optional(),
    expiry: share.expiry.optional(),
    burn: share.burn.optional(),
    /** Folders: reset the visibility of everything inside to "inherit". */
    applyDown: z.boolean().optional(),
  })
  .strict();

export type ApiV1SharePatch = z.infer<typeof apiV1SharePatchSchema>;

/** GET/PATCH /api/v1/nodes/:id/share and POST /api/v1/nodes/:id/link: an item's share link and settings. */
export interface ApiV1Share {
  id: string;
  name: string;
  type: "file" | "folder";
  linkId: string;
  url: string;
  /** The item's own setting ("inherit" follows the folder above). */
  visibility: NodeSettingsDto["visibility"];
  /** What visitors get: the item's setting or the one it inherits. */
  effectiveVisibility: "private" | "public";
  access: NodeSettingsDto["access"];
  downloadLimit: number | null;
  downloads: number;
  note: string;
  hasPassword: boolean;
  /** Admin settings (read by anyone, changed by admins only). */
  expiry: string;
  expAt: string | null;
  burn: boolean;
}

