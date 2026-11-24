import { z } from "zod";
import { FILES } from "@/config/policy";
import { nodeIdSchema, type TaggedItem } from "./nodes";

/** An item of "Shared by me": where it is, its share settings, and when its link was last used. */
export interface SharedItem extends TaggedItem {
  /** Last open, play or download through its share link (ISO), or null. */
  lastActivityAt: string | null;
}

/** GET /api/shares — everything that can be opened from outside, newest first. */
export interface SharedView {
  items: SharedItem[];
  /** More items have share settings than the list reads (SHARE.sharedListMax). */
  truncated: boolean;
}

/** POST /api/shares/private — makes these items private. */
export const makePrivateSchema = z.object({ ids: z.array(nodeIdSchema).min(1).max(FILES.maxBatchItems) });
