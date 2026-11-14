import { z } from "zod";
import { TIMELINE } from "@/config/policy";

/** One photo or video in the "Photos" timeline (GET /api/timeline). */
export interface TimelineItem {
  id: string;
  name: string;
  kind: "image" | "video";
  /** Bytes, as a decimal string (BigInt in the database). */
  size: string;
  hasThumb: boolean;
  /** When it was taken (EXIF / video metadata), else when the file last changed, else when it arrived. */
  date: string;
  /** `date` is the time it was taken (false: a file date stands in). */
  dated: boolean;
  /** The folder it is in, for "Show in folder"; `parentIsRoot` when that is the account's root. */
  parentId: string;
  parentIsRoot: boolean;
}

/** One page of the timeline, newest first; `nextCursor` is null on the last page. */
export interface TimelinePage {
  items: TimelineItem[];
  nextCursor: string | null;
}

/** GET /api/timeline query: `cursor` from the previous page, `limit` items per page. */
export const timelineQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,16}\.[a-z0-9]{6,32}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(TIMELINE.listLimit).default(TIMELINE.pageSize),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
