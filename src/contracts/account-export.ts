import { z } from "zod";
import { FILES } from "@/config/policy";
import { MAX_SHARE_NOTE_LENGTH } from "@/domain/share";
import { MAX_TAG_LENGTH } from "@/domain/tags";

/**
 * The manifest at the end of an account export (`.relayfiles/manifest.json`): what the files
 * do not carry themselves. Share links, link passwords and tokens are never in it.
 * `npm run storage:import -- --with-metadata` reads it back.
 */
export const EXPORT_FORMAT = 1;

const visibility = z.enum(["inherit", "private", "public"]);

export const exportItemSchema = z.object({
  /** Path below the account root, "/"-separated (the same as in the tar). */
  path: z.string().min(1),
  type: z.enum(["file", "folder"]),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(FILES.maxTagsPerItem),
  note: z.string().max(MAX_SHARE_NOTE_LENGTH),
  visibility,
  access: z.enum(["both", "stream"]),
  downloadLimit: z.number().int().nullable(),
  createdAt: z.string(),
  modifiedAt: z.string().nullable(),
  sha256: z.string().nullable(),
});
export type ExportItem = z.infer<typeof exportItemSchema>;

export const exportManifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  account: z.string(),
  exportedAt: z.string(),
  items: z.array(exportItemSchema),
  /** Organizing folders of Favorites, each as its names from the top. */
  favoriteFolders: z.array(z.array(z.string()).min(1)),
  /** Favorite items by path, with the organizing folder they are in ([] = the top of Favorites). */
  favorites: z.array(z.object({ path: z.string().min(1), folder: z.array(z.string()) })),
  /** Files that could not be read when the export ran (left out of the tar). */
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type ExportManifest = z.infer<typeof exportManifestSchema>;
