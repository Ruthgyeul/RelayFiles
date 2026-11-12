import "server-only";
import { getEnv } from "@/config/env";

/** Hours deleted items can be restored before the daily cleanup removes them (TRASH_RETENTION_HOURS). */
export function trashRetentionHours(): number {
  return getEnv("storage").TRASH_RETENTION_HOURS;
}
