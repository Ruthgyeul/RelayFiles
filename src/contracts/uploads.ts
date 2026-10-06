import { z } from "zod";

/** How to handle files that already exist in the target folder (duplicate dialog). */
export const DUPLICATE_POLICIES = ["replace", "keep", "skip"] as const;
export type DuplicatePolicy = (typeof DUPLICATE_POLICIES)[number];

/** Longest relative path accepted from a folder upload ("Photos/2024/a.jpg"). */
const MAX_REL_PATH = 4_096;
/** Files one upload batch may contain. */
export const MAX_FILES_PER_BATCH = 10_000;

export const prepareUploadSchema = z.object({
  /** "home" creates a new folder at the root for this upload; otherwise a folder id or "root". */
  target: z.union([z.literal("home"), z.literal("root"), z.string().regex(/^[a-z0-9]{12}$/)]),
  files: z
    .array(z.object({ rel: z.string().min(1).max(MAX_REL_PATH), size: z.number().int().nonnegative() }))
    .min(1)
    .max(MAX_FILES_PER_BATCH),
  dup: z.enum(DUPLICATE_POLICIES).optional(),
  /** Name for a Home upload of loose files, formatted in the uploader's time zone ("Upload Oct 5, 3:12 PM"). */
  fallbackName: z.string().max(255).optional(),
});

export type PrepareUploadInput = z.infer<typeof prepareUploadSchema>;

export type PrepareUploadResult =
  | { kind: "duplicates"; names: string[] }
  | { kind: "nothing" }
  | {
      kind: "ready";
      batchId: string;
      /** tus endpoint for this batch (per storage volume). */
      endpoint: string;
      folder: { id: string; name: string };
      /** Files to send, by index into the request's list (skipped files are left out). */
      files: { index: number; rel: string; size: number }[];
    };

/** Body returned by the tus server when a file finishes. */
export interface UploadedFile {
  nodeId: string;
  name: string;
  folderId: string;
}

/** tus metadata keys sent with each file. */
export const UPLOAD_METADATA = { batch: "batch", index: "index", filename: "filename" } as const;
