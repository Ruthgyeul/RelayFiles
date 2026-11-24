import "server-only";
import { Readable } from "node:stream";
import { SHARE } from "@/config/policy";
import { subtreePaths } from "@/domain/subtree";
import { zipName } from "@/domain/serving";
import { type DownloadBlock } from "@/domain/share-access";
import type { ClientInfo } from "../auth/client-info";
import { countInWindow } from "../redis";
import { noteUsedUp } from "./link-notify";
import { downloadsUsedUp, limitingFoldersBelow, type LimitFacts } from "@/domain/share-limits";
import { db } from "../db/client";
import type { Busy } from "@/domain/share";
import { segmentsBelowRoot } from "@/domain/tree";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { claimDownload, claimEachDownload, type SharedRow } from "../repositories/share.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { assertShareTraffic, countLinkTraffic } from "./traffic-cap";
import { busyLevels, recordDownload } from "./busy";
import { logLinkEvent } from "./events";
import { assertSharedFolderZippable, resolveSharedFolder, sharedFolderTree, type SharedFolder, type SharedFolderTree } from "./share-access";
import { downloadBlockOf, pausedOn, type ShareViewer } from "./share-link";
import { driverForAccount } from "../services/volume.service";
import { MISSING_REASON, zipResponse, type ZipEntry } from "../services/zip.service";
import { scanBlock } from "@/domain/scan";
import { publicImage, publicImageBlock, stripsMedia } from "./share-files.service";
import { BUSY } from "@/domain/share";
import { heicCopyName, isHeicType } from "@/domain/heic";

/** Why a file is left out of "Download all", as written in "Not included.txt". */
type ZipSkip = DownloadBlock | "location" | "not-ready" | "scanning" | "blocked" | "missing";

const SKIP_REASONS: Record<ZipSkip, string> = {
  "stream-only": "Stream only",
  limit: "Download limit reached",
  paused: "Downloads paused",
  location: "Photo or video that can't be shared without its location data",
  "not-ready": "Photo or video still being prepared for sharing, try again in a moment",
  scanning: "Still being checked for viruses, try again in a moment",
  blocked: "Couldn't be checked for viruses",
  missing: MISSING_REASON,
};

/** The files of a shared folder, with what keeps each one out of the zip (null = included). */
function zipPlan({ link, folder }: SharedFolder, { rows, wayAbove }: SharedFolderTree, owner: AccountRow, busy: Map<string, Busy>, inner: ReadonlyMap<string, readonly LimitFacts[]>) {
  const files: { row: SharedRow; name: string; segments: string[]; skip: ZipSkip | null }[] = [];
  const folders: string[] = [];
  for (const { row, segments } of subtreePaths(rows, folder.id)) {
    // The folder itself is the zip's top folder, named in every entry.
    if (row.id === folder.id) continue;
    const name = [folder.name, ...segments].join("/");
    if (row.type === "FOLDER") {
      folders.push(name);
      continue;
    }
    const imageBlock = stripsMedia(owner, row) ? publicImageBlock(row) : null;
    // A folder inside with its own download limit counts for the files below it, as when they
    // are downloaded one by one: once it has none left, its files stay out.
    const innerBlock = (inner.get(row.id) ?? []).some(downloadsUsedUp) ? "limit" : null;
    // A file storage:fsck found gone from the disk would cut the zip off halfway.
    const skip = row.missing ? "missing" : link.isOwner ? imageBlock : (scanBlock(row.scanState) ?? downloadBlockOf(row, wayAbove(row), busy.get(row.id)) ?? innerBlock ?? imageBlock);
    files.push({ row, name, segments, skip });
  }
  return { files, folders };
}

/** "Not included.txt": each left-out file with the reason, so a zip never silently drops files. */
function skippedNote(skipped: readonly { name: string; skip: ZipSkip }[]): string {
  const lines = skipped.map(({ name, skip }) => `${name}  (${SKIP_REASONS[skip]})`);
  return `These files are not included:\n\n${lines.join("\n")}\n`;
}

/**
 * "Download all": a zip of a folder inside a share link, with the same per-file rules as
 * single downloads (stream-only, download limits, paused files) and images cleaned like
 * single downloads. Each included file is counted like a single download of it.
 */
export async function zipSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const shared = await resolveSharedFolder(linkId, folderId, viewer, now);
  const { link, folder } = shared;
  const tree = await sharedFolderTree(shared, now);
  // loadLink read the owner already (the storage volume and the metadata setting).
  const { owner } = link;
  if (!link.isOwner) await assertShareTraffic(owner, shared.capped, now);
  const driver = await driverForAccount(owner);
  const base = segmentsBelowRoot(shared.chain);

  const allFiles = tree.rows.filter((row) => row.type === "FILE");
  const busy = await busyLevels(
    allFiles.map((row) => ({ id: row.id, dlPaused: pausedOn(row, tree.wayAbove(row)) })),
    now,
  );
  // Folders inside the zipped one that limit downloads, per file (the zipped folder and those
  // above it are in shared.counted).
  const inner = limitingFoldersBelow(tree.rows, folder.id);
  const plan = zipPlan(shared, tree, owner, busy, inner);

  if (!link.isOwner) {
    const claimed = await claimDownload(db(), shared.counted);
    if (!claimed) throw new ApiError("FORBIDDEN", "Download limit reached");
    // Each limiting folder inside counts once for the zip; one at its limit by now leaves its files out.
    const innerOf = (file: (typeof plan.files)[number]) => (inner.get(file.row.id) ?? []).map((row) => row.id);
    const inside = await claimEachDownload(db(), [...new Set(plan.files.filter((file) => file.skip === null).flatMap(innerOf))]);
    for (const file of plan.files) if (file.skip === null && innerOf(file).some((id) => !inside.counted.has(id))) file.skip = "limit";
    // A file at its limit by now (a download finished meanwhile) is left out like one already used up.
    const included = plan.files.filter((file) => file.skip === null);
    const files = await claimEachDownload(db(), included.map((file) => file.row.id));
    for (const file of included) if (!files.counted.has(file.row.id)) file.skip = "limit";
    noteUsedUp(link.root.accountId, [...claimed.usedUp, ...inside.usedUp, ...files.usedUp]);
    await recordDownload(shared.path, now).catch((error: unknown) => logger.warn("busy level not recorded", { error }));
    void logLinkEvent(folder, "DOWNLOAD", client);
  }

  const entries: ZipEntry[] = plan.folders.map((name) => ({ name, folder: true }));
  const skipped: { name: string; skip: ZipSkip }[] = [];
  let bytes = 0n;
  for (const file of plan.files) {
    if (file.skip !== null) {
      skipped.push({ name: file.name, skip: file.skip });
      continue;
    }
    bytes += file.row.size;
    const location = { accountId: owner.id, segments: [...base, ...file.segments] };
    const row = file.row;
    const strips = stripsMedia(owner, row);
    entries.push({
      // A HEIC photo's public copy is a JPEG (see serveSharedFile).
      name: strips && isHeicType(row.mime ?? "") ? heicCopyName(file.name) : file.name,
      open: strips ? async () => (await publicImage(driver, location, row)).open() : () => driver.createReadStream(location),
    });
  }
  if (skipped.length > 0) entries.push({ name: `${folder.name}/Not included.txt`, open: async () => Readable.from([Buffer.from(skippedNote(skipped))]) });
  addTraffic(db(), owner.id, bytes, new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
  if (!link.isOwner) countLinkTraffic(shared.capped, bytes, now);
  // A busy folder, or a busy file going into the zip, slows it down like a single download.
  const throttled = shared.busy.level === BUSY.throttled || plan.files.some((file) => file.skip === null && busy.get(file.row.id)?.level === BUSY.throttled);
  return zipResponse(entries, zipName([{ name: folder.name, folder: true }], folder.name), { bytesPerSecond: throttled ? SHARE.throttledBytesPerSec : undefined });
}

/** HEAD for "Download all": the same checks as the zip (its size too), without building or counting it. */
export async function checkSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: Pick<ClientInfo, "ipKey">): Promise<Response> {
  if ((await countInWindow(`zipcheck:${client.ipKey}`, SHARE.zipCheckWindowSec)) > SHARE.zipChecksPerAddress) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", { retryAfter: SHARE.zipCheckWindowSec });
  }
  const now = Date.now();
  await assertSharedFolderZippable(await resolveSharedFolder(linkId, folderId, viewer, now), now);
  return new Response(null, { status: 200, headers: { "content-type": "application/zip", "cache-control": "private, no-store" } });
}
