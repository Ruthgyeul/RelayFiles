import "server-only";
import { getEnv } from "@/config/env";
import type { StripMode } from "@/domain/image-metadata";
import type { StripMode as StoredStripMode } from "../db/generated/enums";

/** SHARE_METADATA_STRIP: what shared copies of photos and videos lose, or "none" (shared as uploaded). */
export function shareStripMode(): StripMode | "none" {
  return getEnv("jobs").SHARE_METADATA_STRIP;
}

export const storedStripMode = (mode: StripMode): StoredStripMode => (mode === "all" ? "ALL" : "SENSITIVE");

/**
 * Whether a stripped copy made in `made` mode may go out under `wanted`: a copy that removed
 * everything always may; one that kept the capture time only while that is still wanted.
 * Copies from before the column (null) removed everything.
 */
export function copySatisfies(made: StoredStripMode | null, wanted: StripMode): boolean {
  return made === null || made === "ALL" || wanted === "sensitive";
}
