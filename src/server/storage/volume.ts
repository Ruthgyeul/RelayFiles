import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { STORAGE } from "@/config/policy";
import { DIR_MODE, FILE_MODE, layoutOf } from "./layout";

const markerSchema = z.object({
  volumeId: z.string().min(1),
  layoutVersion: z.number().int().positive(),
  createdAt: z.string(),
});

export type VolumeMarker = z.infer<typeof markerSchema>;

export type VolumeState =
  | { state: "online"; marker: VolumeMarker }
  | { state: "offline"; reason: string }
  | { state: "mismatch"; reason: string; marker: VolumeMarker }
  | { state: "layout-mismatch"; reason: string; marker: VolumeMarker };

/** Reads the marker file; null when it is missing or unreadable (e.g. the SSD is not mounted). */
export async function readVolumeMarker(root: string): Promise<VolumeMarker | null> {
  try {
    return markerSchema.parse(JSON.parse(await readFile(layoutOf(root).marker, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Prepares an empty volume: creates the layout directories and writes the marker.
 * Refuses to overwrite an existing marker so a mounted volume is never re-initialised.
 */
export async function initVolume(root: string, volumeId: string, now: Date = new Date()): Promise<VolumeMarker> {
  const existing = await readVolumeMarker(root);
  if (existing) throw new Error(`Volume at ${root} is already initialised (id ${existing.volumeId}).`);
  const layout = layoutOf(root);
  for (const dir of [layout.users, layout.uploads, layout.thumbs, layout.derived, layout.trash]) {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
  }
  const marker: VolumeMarker = { volumeId, layoutVersion: STORAGE.layoutVersion, createdAt: now.toISOString() };
  await writeFile(layout.marker, `${JSON.stringify(marker, null, 2)}\n`, { mode: FILE_MODE, flag: "wx" });
  return marker;
}

/** Replaces the marker atomically (write a temporary file, then rename over the old one). */
export async function writeVolumeMarker(root: string, marker: VolumeMarker): Promise<void> {
  const path = layoutOf(root).marker;
  await writeFile(`${path}.tmp`, `${JSON.stringify(marker, null, 2)}\n`, { mode: FILE_MODE });
  await rename(`${path}.tmp`, path);
}

/**
 * Verifies that the expected volume is mounted. A missing marker means the SSD is not
 * mounted (the mount point is an empty directory on the system disk) and nothing may be
 * written there (docs/plan.md §13.5 "마운트 상태 감시").
 */
export async function checkVolume(root: string, expectedId: string): Promise<VolumeState> {
  const marker = await readVolumeMarker(root);
  if (!marker) return { state: "offline", reason: `No volume marker at ${root}; the storage device is not mounted.` };
  if (marker.volumeId !== expectedId) {
    return { state: "mismatch", reason: `Mounted volume ${marker.volumeId} is not the expected ${expectedId}.`, marker };
  }
  if (marker.layoutVersion !== STORAGE.layoutVersion) {
    return {
      state: "layout-mismatch",
      reason: `Volume layout ${marker.layoutVersion} needs migration to ${STORAGE.layoutVersion} (npm run storage:migrate).`,
      marker,
    };
  }
  return { state: "online", marker };
}
