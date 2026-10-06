/**
 * Service status levels from the design's Status page (`LV`). The footer and the Status
 * page use the same wording.
 */
export type StatusLevel = "ok" | "warn" | "down";

export const STATUS_TITLE: Record<StatusLevel, string> = {
  ok: "All systems operational",
  warn: "Degraded performance",
  down: "Can't reach the server",
};

/** Maps the health endpoint's component status to a level. */
export function levelOfHealth(status: "ok" | "degraded" | "down" | null): StatusLevel {
  if (status === "ok") return "ok";
  if (status === "degraded") return "warn";
  return "down";
}
