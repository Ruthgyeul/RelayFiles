import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, readdir, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FILE_MODE, type VolumeLayout } from "../layout";
import type { SpaceInfo } from "../driver";
import { trashTime } from "./trash";

// The daily purge of system/ and the volume's health (writable, free space).

export async function purgeSystem(layout: VolumeLayout, trashBefore: Date, uploadsBefore: Date, transcodedBefore: Date): Promise<{ trash: number; uploads: number; transcoded: number }> {
  const entries = async (dir: string) => readdir(dir).catch(() => [] as string[]);
  let trash = 0;
  for (const name of await entries(layout.trash)) {
    // Entries start with the time they were moved (the item keeps its own mtime).
    const movedAt = trashTime(name);
    if (movedAt === null || movedAt >= trashBefore.getTime()) continue;
    await rm(join(layout.trash, name), { recursive: true, force: true });
    trash++;
  }
  let uploads = 0;
  for (const name of await entries(layout.uploads)) {
    const path = join(layout.uploads, name);
    // The entry's own time: an upload's last write, or when a copy's staging folder was filled
    // (never the time of the files inside it: hard links keep the original's).
    const info = await lstat(path).catch(() => null);
    if (!info || info.mtime >= uploadsBefore) continue;
    await rm(path, { recursive: true, force: true });
    uploads++;
  }
  // Conversions are made again after a few more plays; old ones only take space.
  let transcoded = 0;
  for (const account of await entries(layout.transcoded)) {
    const dir = join(layout.transcoded, account);
    for (const name of await entries(dir)) {
      const path = join(dir, name);
      const info = await lstat(path).catch(() => null);
      if (!info || info.mtime >= transcodedBefore) continue;
      await rm(path, { force: true });
      transcoded++;
    }
  }
  return { trash, uploads, transcoded };
}

export async function canWrite(layout: VolumeLayout): Promise<boolean> {
  const probe = join(layout.uploads, `.probe-${randomUUID()}`);
  try {
    await writeFile(probe, "", { mode: FILE_MODE, flag: "wx" });
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe, { force: true });
  }
}

export async function space(layout: VolumeLayout): Promise<SpaceInfo> {
  const info = await statfs(layout.root, { bigint: true });
  return { total: info.blocks * info.bsize, available: info.bavail * info.bsize };
}
