/**
 * The volume watch (worker, every VOLUME_WATCH_INTERVAL_SEC): a volume whose marker file is
 * gone (the SSD came off, the mount point is an empty folder on the system disk) or names
 * another volume is taken OFFLINE, so nothing is written there; it comes back ACTIVE when its
 * marker is readable again. Volumes being migrated (READONLY, DRAINING) are left alone.
 */
export type VolumeStatus = "ACTIVE" | "READONLY" | "DRAINING" | "OFFLINE";
export type MarkerState = "online" | "offline" | "mismatch" | "layout-mismatch";

/** The status to switch to, or null to keep the current one. */
export function watchedStatus(current: VolumeStatus, marker: MarkerState): VolumeStatus | null {
  if (current === "ACTIVE" && (marker === "offline" || marker === "mismatch")) return "OFFLINE";
  if (current === "OFFLINE" && marker === "online") return "ACTIVE";
  return null;
}
