import { z } from "zod";
import { SHARE } from "@/config/policy";
import { ID_PATTERN } from "@/domain/ids";
import { MAX_DOWNLOAD_LIMIT, MAX_SHARE_NOTE_LENGTH, MAX_SHARE_PASSWORD_LENGTH } from "@/domain/share";
import type { NodeKind } from "@/domain/tree";
import { nodeIdSchema } from "./nodes";

export const collectionIdSchema = z.string().regex(ID_PATTERN.collection);

const nodeIds = z.array(nodeIdSchema).min(1).max(SHARE.collectionMaxItems);

/** A collection's own share settings (expiry and delete-after-download: admins only, as for items). */
const settings = {
  name: z.string().trim().min(1).max(SHARE.collectionNameMax),
  note: z.string().max(MAX_SHARE_NOTE_LENGTH),
  expiry: z.string().max(16),
  burn: z.boolean(),
  downloadLimit: z.number().int().positive().max(MAX_DOWNLOAD_LIMIT).nullable(),
  /** "" removes the password. */
  password: z.string().max(MAX_SHARE_PASSWORD_LENGTH),
  access: z.enum(["both", "stream"]),
};

/** POST /api/collections (and /api/v1/collections): the items in order, a name, and optional settings. */
export const createCollectionSchema = z.object({
  ...settings,
  note: settings.note.default(""),
  expiry: settings.expiry.default("Never"),
  burn: settings.burn.default(false),
  downloadLimit: settings.downloadLimit.default(null),
  password: settings.password.default(""),
  access: settings.access.default("both"),
  nodeIds,
});

/** PATCH /api/collections/:id: what to change (absent: keep). `nodeIds` replaces the items, in order. */
export const updateCollectionSchema = z.object({
  name: settings.name.optional(),
  note: settings.note.optional(),
  expiry: settings.expiry.optional(),
  burn: settings.burn.optional(),
  downloadLimit: settings.downloadLimit.optional(),
  password: settings.password.optional(),
  access: settings.access.optional(),
  nodeIds: nodeIds.optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

/** A file or folder of a collection, as its owner sees it. */
export interface CollectionItem {
  id: string;
  type: "file" | "folder";
  name: string;
  kind: NodeKind | null;
}

/** A collection link and its settings (GET /api/collections). */
export interface CollectionDto {
  id: string;
  linkId: string;
  /** Full link, e.g. https://files.example.com/d/abc. */
  url: string;
  name: string;
  note: string;
  expiry: string;
  expAt: string | null;
  burn: boolean;
  downloadLimit: number | null;
  downloads: number;
  hasPassword: boolean;
  access: "both" | "stream";
  createdAt: string;
  /** Its items in order (deleted ones are gone). */
  items: CollectionItem[];
}
