import "server-only";
import { resolve } from "node:path";
import { getEnv } from "@/config/env";
import { ApiError } from "../http/api-error";
import type { StorageDriver } from "./driver";
import { LocalVolumeDriver } from "./local-volume";

export interface VolumeRecord {
  id: string;
  driver: "LOCAL" | "S3";
  mountPath: string;
  status: "ACTIVE" | "READONLY" | "DRAINING" | "OFFLINE";
}

const drivers = new Map<string, { mountPath: string; driver: StorageDriver }>();

/**
 * Returns the storage driver for a volume row (one instance per volume). A volume registered
 * again at another path (npm run volume:init after a remount) gets a new driver for that path,
 * without restarting the app.
 */
export function driverFor(volume: VolumeRecord): StorageDriver {
  if (volume.status === "OFFLINE") throw new ApiError("STORAGE_OFFLINE");
  const existing = drivers.get(volume.id);
  if (existing?.mountPath === volume.mountPath) return existing.driver;
  if (volume.driver !== "LOCAL") throw new ApiError("INTERNAL", "This storage driver is not available.");
  const driver = new LocalVolumeDriver(volume.id, volume.mountPath);
  drivers.set(volume.id, { mountPath: volume.mountPath, driver });
  return driver;
}

/** Absolute path of the volume configured by STORAGE_ROOT (the first SSD). */
export function configuredVolumeRoot(): string {
  return resolve(getEnv("storage").STORAGE_ROOT);
}

export interface VolumeCandidate {
  id: string;
  status: VolumeRecord["status"];
  /** Bytes available above the volume's reserve. */
  available: bigint;
}

/** New accounts go to the ACTIVE volume with the most free space (docs/architecture.md "스토리지"). */
export function pickVolumeForNewAccount(candidates: readonly VolumeCandidate[]): string | null {
  let best: VolumeCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.status !== "ACTIVE" || candidate.available <= 0n) continue;
    if (!best || candidate.available > best.available) best = candidate;
  }
  return best?.id ?? null;
}

/** Space usable for uploads after keeping `reservePct` percent of the volume free. */
export function availableAboveReserve(total: bigint, available: bigint, reservePct: number): bigint {
  const reserve = (total * BigInt(Math.round(reservePct * 100))) / 10_000n;
  const usable = available - reserve;
  return usable > 0n ? usable : 0n;
}
