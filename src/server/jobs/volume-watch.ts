import "server-only";
import { watchedStatus } from "@/domain/volume-watch";
import { db } from "../db/client";
import { logger } from "../logger";
import { listVolumesIn, switchVolumeStatus } from "../repositories/volume.repo";
import { availableAboveReserve, driverFor } from "../storage/registry";
import { checkVolume, type VolumeState } from "../storage/volume";
import { notifyEnabled, queueThrottled, THROTTLE_MS } from "./notify-queue";

type WatchedVolume = Awaited<ReturnType<typeof listVolumesIn>>[number];

/** The owner hears about a volume going offline or coming back (at most once per throttle window). */
async function notifyStatus(volume: WatchedVolume, status: "ACTIVE" | "OFFLINE", check: VolumeState): Promise<void> {
  if (status === "OFFLINE") {
    await queueThrottled({ kind: "volume-offline", volumeId: volume.id, cause: check.state === "mismatch" ? "mismatch" : "missing" }, volume.id, THROTTLE_MS["volume-offline"]);
  } else {
    await queueThrottled({ kind: "volume-online", volumeId: volume.id }, volume.id, THROTTLE_MS["volume-online"]);
  }
}

/**
 * Alerts for a mounted ACTIVE volume (only while notifications are on): free space below the
 * reserve the upload checks keep (uploads are refused), and a volume that refuses writes (an
 * ext4 filesystem remounted read-only after errors keeps its marker readable).
 */
async function checkActiveVolume(volume: WatchedVolume): Promise<void> {
  if (!notifyEnabled()) return;
  const driver = driverFor({ ...volume, status: "ACTIVE" });
  const [space, writable] = await Promise.all([driver.space(), driver.canWrite()]);
  if (!writable) await queueThrottled({ kind: "volume-readonly", volumeId: volume.id }, volume.id, THROTTLE_MS["volume-readonly"]);
  else if (availableAboveReserve(space.total, space.available, volume.reservePct) === 0n) {
    await queueThrottled({ kind: "volume-low", volumeId: volume.id, freeBytes: Number(space.available), reservePct: volume.reservePct }, volume.id, THROTTLE_MS["volume-low"]);
  }
}

/**
 * One round of the volume watch (domain/volume-watch.ts): ACTIVE volumes without their marker
 * go OFFLINE (uploads and new accounts stop, the Status page shows Storage down), OFFLINE ones
 * whose marker is back return to ACTIVE. With NOTIFY_WEBHOOK_URL set it also queues the owner's
 * alerts for those changes and for low or unwritable volumes. Returns the changes made.
 */
export async function watchVolumes(): Promise<{ volumeId: string; status: "ACTIVE" | "OFFLINE" }[]> {
  const changes: { volumeId: string; status: "ACTIVE" | "OFFLINE" }[] = [];
  const volumes = await listVolumesIn(db(), ["ACTIVE", "OFFLINE"], "LOCAL");
  for (const volume of volumes) {
    const check = await checkVolume(volume.mountPath, volume.id);
    const next = watchedStatus(volume.status, check.state);
    // Only if nobody changed it meanwhile (a migration may have set READONLY).
    const switched = (next === "ACTIVE" || next === "OFFLINE") && (await switchVolumeStatus(db(), volume.id, volume.status, next));
    if (switched) {
      changes.push({ volumeId: volume.id, status: next });
      if (next === "OFFLINE") logger.error("storage volume went offline", { volumeId: volume.id, reason: check.state === "online" ? "" : check.reason });
      else logger.warn("storage volume is back online", { volumeId: volume.id });
      await notifyStatus(volume, next, check);
    }
    const status = switched ? next : volume.status;
    if (status === "ACTIVE" && check.state === "online") {
      await checkActiveVolume(volume).catch((error: unknown) => logger.warn("volume alerts not checked", { volumeId: volume.id, error }));
    }
  }
  return changes;
}
