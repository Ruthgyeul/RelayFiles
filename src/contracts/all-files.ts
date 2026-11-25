import { z } from "zod";
import { ALL_FILES, SEARCH } from "@/config/policy";
import { ALL_FILES_SORT_KEYS } from "@/domain/all-files";
import type { TaggedItem } from "./nodes";

/** File kinds the "All Files" type filter offers (folders are never listed). */
export const ALL_FILES_KINDS = ["all", "video", "audio", "image", "other"] as const;
export type AllFilesKind = (typeof ALL_FILES_KINDS)[number];

/** GET /api/files/all — one page; `q` reads like global search (words, #tags, type:, newer:/older:). */
export const allFilesQuerySchema = z.object({
  sort: z.enum(ALL_FILES_SORT_KEYS).default("date"),
  kind: z.enum(ALL_FILES_KINDS).default("all"),
  q: z.string().max(SEARCH.maxQueryLength).default(""),
  cursor: z.string().max(ALL_FILES.cursorMaxLength).optional(),
  limit: z.coerce.number().int().min(1).max(ALL_FILES.listLimit).default(ALL_FILES.pageSize),
});
export type AllFilesQuery = z.infer<typeof allFilesQuerySchema>;

export interface AllFilesPage {
  /** Files with the folder each is in, in the asked order. */
  items: TaggedItem[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
  /**
   * First page only (null on later pages): files matching the search, in all and per type
   * (the type filter itself left out, so every chip shows its own count).
   */
  counts: AllFilesCounts | null;
}

export type AllFilesCounts = Record<AllFilesKind, number>;
