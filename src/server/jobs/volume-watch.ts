import "server-only";
import { watchedStatus } from "@/domain/volume-watch";
import { db } from "../db/client";
import { logger } from "../logger";
import { checkVolume } from "../storage/volume";

/**
 * One round of the volume watch (domain/volume-watch.ts): ACTIVE volumes without their marker
 * go OFFLINE (uploads and new accounts stop, the Status page shows Storage down), OFFLINE ones
 * whose marker is back return to ACTIVE. Returns the changes made.
 */
export async function watchVolumes(): Promise<{ volumeId: string; status: "ACTIVE" | "OFFLINE" }[]> {
  const changes: { volumeId: string; status: "ACTIVE" | "OFFLINE" }[] = [];
  const volumes = await db().storageVolume.findMany({ where: { driver: "LOCAL", status: { in: ["ACTIVE", "OFFLINE"] } }, select: { id: true, mountPath: true, status: true } });
  for (const volume of volumes) {
    const check = await checkVolume(volume.mountPath, volume.id);
    const next = watchedStatus(volume.status, check.state);
    if (next !== "ACTIVE" && next !== "OFFLINE") continue;
    // Only if nobody changed it meanwhile (a migration may have set READONLY).
    const { count } = await db().storageVolume.updateMany({ where: { id: volume.id, status: volume.status }, data: { status: next } });
    if (count === 0) continue;
    changes.push({ volumeId: volume.id, status: next });
    if (next === "OFFLINE") logger.error("storage volume went offline", { volumeId: volume.id, reason: check.state === "online" ? "" : check.reason });
    else logger.warn("storage volume is back online", { volumeId: volume.id });
  }
  return changes;
}
