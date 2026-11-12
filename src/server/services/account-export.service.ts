import "server-only";
import { Readable } from "node:stream";
import { pack as tarPack, type Pack } from "tar-stream";
import { EXPORT } from "@/config/policy";
import { EXPORT_FORMAT, type ExportItem, type ExportManifest } from "@/contracts/account-export";
import { compareExportPaths, EXPORT_MANIFEST_PATH, exportFileName, favoriteFolderPaths } from "@/domain/account-export";
import { contentDisposition } from "@/domain/serving";
import { subtreePaths } from "@/domain/subtree";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { listFavoriteFolders, listFavoritesOf } from "../repositories/favorite.repo";
import { findRootFolder } from "../repositories/node.repo";
import { subtreeRowsOf } from "../repositories/node-tree.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { redis } from "../redis";
import { acquireSlot, type SemaphoreSlot } from "../redis-semaphore";
import type { StorageDriver } from "../storage/driver";
import { VISIBILITY } from "./node.service";
import { driverForAccount } from "./volume.service";

type Owner = Pick<AccountRow, "id" | "name" | "volumeId">;
type TreeNode = Awaited<ReturnType<typeof subtreeRowsOf>> extends Map<string, (infer R)[]> ? R : never;

const MINUTE_SEC = 60;
const turnKey = (accountId: string) => `export:turn:${accountId}`;

/** Refuses an export while the last one started less than EXPORT.repeatAfterMinutes ago. */
export async function assertExportAllowed(accountId: string): Promise<void> {
  const wait = await redis().ttl(turnKey(accountId));
  if (wait > 0) throw new ApiError("RATE_LIMITED", "An export was started a few minutes ago. Try again later.", { retryAfter: wait });
}

/** Takes this account's export turn: one start per EXPORT.repeatAfterMinutes. */
async function takeTurn(accountId: string): Promise<void> {
  const seconds = EXPORT.repeatAfterMinutes * MINUTE_SEC;
  if ((await redis().set(turnKey(accountId), "1", "EX", seconds, "NX")) !== "OK") await assertExportAllowed(accountId);
}

const toItem = (row: TreeNode, path: string): ExportItem => ({
  path,
  type: row.type === "FOLDER" ? "folder" : "file",
  tags: row.tags,
  note: row.note,
  visibility: VISIBILITY[row.visibility],
  access: row.access === "STREAM" ? "stream" : "both",
  downloadLimit: row.downloadLimit,
  createdAt: row.createdAt.toISOString(),
  modifiedAt: row.modifiedAt?.toISOString() ?? null,
  sha256: row.sha256,
});

interface ExportPlan {
  rows: { row: TreeNode; path: string; segments: string[] }[];
  manifest: Omit<ExportManifest, "skipped">;
}

/** Everything the export holds, read once when it starts. */
async function planExport(owner: Owner, now: Date): Promise<ExportPlan> {
  const root = await findRootFolder(db(), owner.id);
  if (!root) throw new ApiError("NOT_FOUND");
  const tree = (await subtreeRowsOf(db(), [root.id])).get(root.id) ?? [];
  // A replaced file's row stepping aside has a "/" in its name: never exported.
  const rows = subtreePaths(tree, root.id)
    .filter(({ row }) => row.id !== root.id && !row.name.includes("/"))
    .map(({ row, segments }) => ({ row, segments, path: segments.join("/") }))
    // The database returns siblings in no set order: sort so every export of a tree is the same.
    .sort((a, b) => compareExportPaths(a.segments, b.segments));
  const pathOf = new Map(rows.map(({ row, path }) => [row.id, path]));
  const [folders, favorites] = await Promise.all([listFavoriteFolders(db(), owner.id), listFavoritesOf(db(), owner.id)]);
  const folderPaths = favoriteFolderPaths(folders);
  return {
    rows,
    manifest: {
      format: EXPORT_FORMAT,
      account: owner.name,
      exportedAt: now.toISOString(),
      items: rows.map(({ row, path }) => toItem(row, path)),
      // Parents before their folders, so a reader can create them in order.
      favoriteFolders: [...folderPaths.values()].sort((a, b) => a.length - b.length || a.join("/").localeCompare(b.join("/"))),
      favorites: favorites.flatMap(({ nodeId, folderId }) => {
        const path = pathOf.get(nodeId);
        return path ? [{ path, folder: folderId ? (folderPaths.get(folderId) ?? []) : [] }] : [];
      }),
    },
  };
}

/** Adds one file to the tar from disk; the size on disk is what goes in (a missing file is skipped). */
async function addFile(pack: Pack, driver: StorageDriver, owner: Owner, entry: ExportPlan["rows"][number]): Promise<{ bytes: number } | { skipped: string }> {
  if (entry.row.missing) return { skipped: "missing" };
  const location = { accountId: owner.id, segments: entry.segments };
  const stat = await driver.stat(location);
  if (!stat || stat.type !== "file") return { skipped: "not on disk" };
  const size = Number(stat.size);
  const mtime = entry.row.modifiedAt ?? entry.row.createdAt;
  if (size === 0) {
    pack.entry({ name: entry.path, size: 0, mtime });
    return { bytes: 0 };
  }
  // Exactly the bytes stat counted, so the tar header stays right if the file grows meanwhile.
  const source = await driver.createReadStream(location, { start: 0, end: size - 1 });
  await new Promise<void>((resolve, reject) => {
    const sink = pack.entry({ name: entry.path, size, mtime }, (error) => (error ? reject(error) : resolve()));
    source.once("error", reject);
    source.pipe(sink);
  });
  return { bytes: size };
}

/** Writes every folder and file, then the manifest (which lists what could not be read). */
async function fillTar(pack: Pack, driver: StorageDriver, owner: Owner, plan: ExportPlan): Promise<number> {
  const skipped: ExportManifest["skipped"] = [];
  let bytes = 0;
  for (const entry of plan.rows) {
    if (pack.destroyed) return bytes;
    if (entry.row.type === "FOLDER") {
      pack.entry({ name: `${entry.path}/`, type: "directory", mtime: entry.row.createdAt });
      continue;
    }
    const added = await addFile(pack, driver, owner, entry);
    if ("skipped" in added) skipped.push({ path: entry.path, reason: added.skipped });
    else bytes += added.bytes;
  }
  const manifest: ExportManifest = { ...plan.manifest, skipped };
  pack.entry({ name: EXPORT_MANIFEST_PATH, mtime: new Date(plan.manifest.exportedAt) }, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  pack.finalize();
  return bytes;
}

/**
 * The whole account as one tar, streamed from disk: every folder and file at its path, then
 * `.relayfiles/manifest.json` with tags, notes, share settings (no links or passwords) and
 * Favorites. One export at a time per account, and one start per EXPORT.repeatAfterMinutes.
 */
export async function exportAccount(owner: Owner, now: Date = new Date()): Promise<Response> {
  await takeTurn(owner.id);
  const slot: SemaphoreSlot | null = await acquireSlot(`export:${owner.id}`, 1, EXPORT.slotLeaseMs);
  if (!slot) throw new ApiError("RATE_LIMITED", "An export of this account is already running.", { retryAfter: EXPORT.repeatAfterMinutes * MINUTE_SEC });
  let plan: ExportPlan;
  let driver: StorageDriver;
  try {
    [plan, driver] = await Promise.all([planExport(owner, now), driverForAccount(owner)]);
  } catch (error) {
    await slot.release();
    throw error;
  }
  const pack = tarPack();
  slot.signal.addEventListener("abort", () => pack.destroy());
  fillTar(pack, driver, owner, plan)
    .then((bytes) => addTraffic(db(), owner.id, BigInt(bytes), new Date()))
    .catch((error: unknown) => {
      logger.error("account export failed", { error });
      pack.destroy();
    })
    .finally(() => void slot.release());
  return new Response(Readable.toWeb(Readable.from(pack)) as ReadableStream, {
    headers: {
      "content-type": "application/x-tar",
      "content-disposition": contentDisposition("attachment", exportFileName(owner.name, now)),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
