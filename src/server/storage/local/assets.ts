import "server-only";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { ASSET_DIRS, DIR_MODE, FILE_MODE, type VolumeLayout } from "../layout";
import type { AssetKind, AssetRef, ByteSource } from "../driver";

// Generated files (thumbnails, stripped copies, previews, conversions) under system/<dir>/<accountId>/<nodeId>.

/** Account and node ids (generated, lowercase alphanumerics). */
export const ASSET_ID = /^[a-z0-9]{6,32}$/;

/** `system/<thumbs|derived|previews|transcoded>/<accountId>/<nodeId>`; ids are generated, never user input. */
function assetPath(layout: VolumeLayout, kind: AssetKind, accountId: string, nodeId: string): string {
  if (!ASSET_ID.test(accountId) || !ASSET_ID.test(nodeId)) throw new Error("Invalid asset id.");
  return join(layout[ASSET_DIRS[kind]], accountId, nodeId);
}

export async function writeAsset(layout: VolumeLayout, { kind, accountId, nodeId }: AssetRef, data: Uint8Array): Promise<void> {
  const target = assetPath(layout, kind, accountId, nodeId);
  await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { mode: FILE_MODE, flag: "wx" });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function stagingPath(layout: VolumeLayout): Promise<string> {
  await mkdir(layout.uploads, { recursive: true, mode: DIR_MODE });
  return join(layout.uploads, `asset-${randomUUID()}`);
}

export async function adoptAsset(layout: VolumeLayout, { kind, accountId, nodeId }: AssetRef, tempPath: string): Promise<void> {
  if (!tempPath.startsWith(layout.uploads)) throw new Error("Generated files must come from the volume's upload area.");
  const target = assetPath(layout, kind, accountId, nodeId);
  await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
  await rename(tempPath, target);
}

export async function assetSource(layout: VolumeLayout, { kind, accountId, nodeId }: AssetRef): Promise<ByteSource | null> {
  const path = assetPath(layout, kind, accountId, nodeId);
  const openAsset = () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let size: number;
  try {
    const handle = await openAsset();
    try {
      size = (await handle.stat()).size;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return { size, open: async (range) => (await openAsset()).createReadStream({ ...range, autoClose: true }) };
}

export async function readAsset(layout: VolumeLayout, { kind, accountId, nodeId }: AssetRef): Promise<{ stream: Readable; size: number } | null> {
  try {
    const handle = await open(assetPath(layout, kind, accountId, nodeId), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    return { stream: handle.createReadStream({ autoClose: true }), size: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeAssets(layout: VolumeLayout, accountId: string, nodeIds: readonly string[]): Promise<void> {
  const kinds = Object.keys(ASSET_DIRS) as AssetKind[];
  await Promise.all(nodeIds.flatMap((nodeId) => kinds.map((kind) => rm(assetPath(layout, kind, accountId, nodeId), { force: true }))));
}

export async function removeAccountAssets(layout: VolumeLayout, accountId: string): Promise<void> {
  if (!ASSET_ID.test(accountId)) throw new Error("Invalid asset id.");
  await Promise.all(Object.values(ASSET_DIRS).map((dir) => rm(join(layout[dir], accountId), { recursive: true, force: true })));
}
