import "server-only";
import { Readable } from "node:stream";
import { SHARE } from "@/config/policy";
import { subtreePaths } from "@/domain/subtree";
import { zipName } from "@/domain/serving";
import { type DownloadBlock } from "@/domain/share-access";
import type { ClientInfo } from "../auth/client-info";
import { countInWindow } from "../redis";
import { noteUsedUp } from "./link-notify";
import { downloadsUsedUp, limitingFoldersBelow, limitsDownloads, type LimitFacts } from "@/domain/share-limits";
import { db } from "../db/client";
import type { Busy } from "@/domain/share";
import { segmentsBelowRoot } from "@/domain/tree";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { claimDownload, claimEachDownload, type SharedRow } from "../repositories/share.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { assertShareTraffic, cappedOn, countLinkTraffic, type CappedItem } from "./traffic-cap";
import { busyLevels, recordDownload } from "./busy";
import { logLinkEvent } from "./events";
import {
  assertCollectionZippable,
  assertSharedFolderZippable,
  collectionEntries,
  collectionTrees,
  openLink,
  resolveSharedFolder,
  sharedFolderTree,
} from "./share-access";
import { type CollectionLink, downloadBlockOf, linkWayAbove, type LoadedLink, pausedOn, type ShareViewer, type WayAbove, wayAboveInTree } from "./share-link";
import { driverForAccount } from "../services/volume.service";
import { MISSING_REASON, zipResponse, type ZipEntry } from "../services/zip.service";
import { scanBlock } from "@/domain/scan";
import { publicImage, publicImageBlock, stripsMedia } from "./share-files.service";
import { BUSY } from "@/domain/share";
import { isHeicType, uniqueHeicCopyName } from "@/domain/heic";

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

/**
 * One shared item put into a zip: a folder with what visitors may see inside it, or a single
 * file (a collection's top level).
 */
interface ZipSource {
  top: SharedRow;
  /** The rows to zip (a folder's tree read from `top` down; a file: just itself). */
  rows: readonly SharedRow[];
  /** Zip path of `top` ("Trip", or "Collection/Trip"). */
  zipPath: string[];
  /** Folder names from the account root down to `top` (where its files are on the volume). */
  base: string[];
  wayAbove: (row: SharedRow) => WayAbove;
  /** Items that limit downloads counted once per included file below `top`, by file id. */
  inner: ReadonlyMap<string, readonly LimitFacts[]>;
}

interface PlannedFile {
  row: SharedRow;
  /** Path in the zip. */
  name: string;
  /** Folder names from the account root down to the file. */
  segments: string[];
  skip: ZipSkip | null;
}

/** The files of the zip sources, with what keeps each one out of the zip (null = included). */
function zipPlan(sources: readonly ZipSource[], link: LoadedLink, busy: Map<string, Busy>) {
  const { owner } = link;
  const files: PlannedFile[] = [];
  const folders: string[] = [];
  for (const source of sources) {
    const paths = source.top.type === "FILE" ? [{ row: source.top, segments: [source.top.name] }] : subtreePaths(source.rows, source.top.id);
    const base = source.top.type === "FILE" ? source.base.slice(0, -1) : source.base;
    const zipBase = source.top.type === "FILE" ? source.zipPath.slice(0, -1) : source.zipPath;
    for (const { row, segments } of paths) {
      const name = [...zipBase, ...segments].join("/");
      if (row.type === "FOLDER") {
        // A zipped folder is named in every entry below it; an empty one still shows up.
        if (row.id !== source.top.id || source.zipPath.length > 1) folders.push(name);
        continue;
      }
      const imageBlock = stripsMedia(owner, row) ? publicImageBlock(row) : null;
      // A folder with its own download limit counts for the files below it, as when they are
      // downloaded one by one: once it has none left, its files stay out.
      const innerBlock = (source.inner.get(row.id) ?? []).some(downloadsUsedUp) ? "limit" : null;
      // A file storage:fsck found gone from the disk would cut the zip off halfway.
      const skip = row.missing
        ? "missing"
        : link.isOwner
          ? imageBlock
          : (scanBlock(row.scanState) ?? downloadBlockOf(row, source.wayAbove(row), busy.get(row.id)) ?? innerBlock ?? imageBlock);
      files.push({ row, name, segments: [...base, ...segments], skip });
    }
  }
  return { files, folders };
}

/** "Not included.txt": each left-out file with the reason, so a zip never silently drops files. */
function skippedNote(skipped: readonly { name: string; skip: ZipSkip }[]): string {
  const lines = skipped.map(({ name, skip }) => `${name}  (${SKIP_REASONS[skip]})`);
  return `These files are not included:\n\n${lines.join("\n")}\n`;
}

/** What a "Download all" zips and counts: from one folder of a link, or a whole collection. */
interface ZipJob {
  link: LoadedLink;
  sources: ZipSource[];
  /** Zip name and its top folder. */
  title: string;
  /** Items counted once for the whole zip (all or nothing), and the collection with them. */
  counted: string[];
  collectionId: string | null;
  /** Ids recorded for the busy level, and the row "Downloaded" is logged on (null: none). */
  path: string[];
  logOn: SharedRow | null;
  capped: CappedItem[];
  throttledTop: boolean;
}

/**
 * "Download all": a zip of a folder inside a share link (or of a collection), with the same
 * per-file rules as single downloads (stream-only, download limits, paused files) and images
 * cleaned like single downloads. Each included file is counted like a single download of it.
 */
export async function zipSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: ClientInfo): Promise<Response> {
  const now = Date.now();
  const link = await openLink(linkId, viewer, now);
  const job = link.kind === "collection" && folderId === link.collection.id ? await collectionJob(link, now) : await folderJob(link, folderId, now);
  return zipJob(job, client, now);
}

async function folderJob(link: LoadedLink, folderId: string, now: number): Promise<ZipJob> {
  const shared = await resolveSharedFolder(link, folderId, now);
  const { folder } = shared;
  if (!link.isOwner) await assertShareTraffic(link.owner, shared.capped, now);
  const tree = await sharedFolderTree(shared, now);
  // Folders inside the zipped one that limit downloads, per file (the zipped folder and those
  // above it are in shared.counted).
  const source: ZipSource = { top: folder, rows: tree.rows, zipPath: [folder.name], base: segmentsBelowRoot(shared.chain), wayAbove: tree.wayAbove, inner: limitingFoldersBelow(tree.rows, folder.id) };
  return { link, sources: [source], title: folder.name, counted: shared.counted, collectionId: shared.collectionId, path: shared.path, logOn: folder, capped: shared.capped, throttledTop: shared.busy.level === BUSY.throttled };
}

/**
 * Every item of a collection, under a top folder named after it. Item limits (and those of the
 * folders above an item) are counted per included file, so an item with no downloads left is
 * left out rather than refusing the whole zip; the collection's own limit counts once.
 */
async function collectionJob(link: CollectionLink, now: number): Promise<ZipJob> {
  if (link.collection.access === "STREAM") throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
  const entries = await collectionEntries(link, now);
  // Every item's daily traffic limit (and those of the folders above it) applies to the zip.
  const capped = [...new Map(entries.flatMap(({ chain }) => cappedOn(chain)).map((item) => [item.id, item])).values()];
  if (!link.isOwner) await assertShareTraffic(link.owner, capped, now);
  const trees = await collectionTrees(entries, now);
  const title = link.collection.name;
  const sources = entries.map(({ row, chain }): ZipSource => {
    const rows = trees.get(row.id) ?? [row];
    const above = chain.slice(0, -1).filter(limitsDownloads);
    const own = row.type === "FOLDER" && limitsDownloads(row) ? [row] : [];
    const below = row.type === "FOLDER" ? limitingFoldersBelow(rows, row.id) : new Map<string, LimitFacts[]>();
    const inner = new Map(rows.filter((at) => at.type === "FILE").map((file) => [file.id, [...(below.get(file.id) ?? []), ...own, ...above]]));
    return { top: row, rows, zipPath: [title, row.name], base: segmentsBelowRoot(chain), wayAbove: wayAboveInTree(row, linkWayAbove(link, chain), new Map(rows.map((at) => [at.id, at]))), inner };
  });
  return { link, sources, title, counted: [], collectionId: link.collection.id, path: [], logOn: null, capped, throttledTop: false };
}

async function zipJob(job: ZipJob, client: ClientInfo, now: number): Promise<Response> {
  const { link } = job;
  const { owner } = link;
  const driver = await driverForAccount(owner);
  const allFiles = job.sources.flatMap((source) => source.rows.filter((row) => row.type === "FILE").map((row) => ({ row, source })));
  const busy = await busyLevels(
    allFiles.map(({ row, source }) => ({ id: row.id, dlPaused: pausedOn(row, source.wayAbove(row)) })),
    now,
  );
  const plan = zipPlan(job.sources, link, busy);
  const innerOf = new Map(job.sources.flatMap((source) => [...source.inner].map(([id, rows]) => [id, rows.map((row) => row.id)] as const)));

  if (!link.isOwner) {
    const claimed = await claimDownload(db(), job.counted, job.collectionId);
    if (!claimed) throw new ApiError("FORBIDDEN", "Download limit reached");
    // Each limiting folder inside counts once for the zip; one at its limit by now leaves its files out.
    const innerIds = (file: PlannedFile) => innerOf.get(file.row.id) ?? [];
    const inside = await claimEachDownload(db(), [...new Set(plan.files.filter((file) => file.skip === null).flatMap(innerIds))]);
    for (const file of plan.files) if (file.skip === null && innerIds(file).some((id) => !inside.counted.has(id))) file.skip = "limit";
    // A file at its limit by now (a download finished meanwhile) is left out like one already used up.
    const included = plan.files.filter((file) => file.skip === null);
    const files = await claimEachDownload(db(), included.map((file) => file.row.id));
    for (const file of included) if (!files.counted.has(file.row.id)) file.skip = "limit";
    noteUsedUp(owner.id, [...claimed.usedUp, ...inside.usedUp, ...files.usedUp]);
    await recordDownload(job.path, now).catch((error: unknown) => logger.warn("busy level not recorded", { error }));
    if (job.logOn) void logLinkEvent(job.logOn, "DOWNLOAD", client);
  }

  const entries: ZipEntry[] = plan.folders.map((name) => ({ name, folder: true }));
  const skipped: { name: string; skip: ZipSkip }[] = [];
  let bytes = 0n;
  // Names in the zip, so a HEIC photo's JPEG copy does not take another file's.
  const taken = new Set(plan.files.filter((file) => file.skip === null).map((file) => file.name));
  for (const file of plan.files) {
    if (file.skip !== null) {
      skipped.push({ name: file.name, skip: file.skip });
      continue;
    }
    bytes += file.row.size;
    const location = { accountId: owner.id, segments: file.segments };
    const row = file.row;
    const strips = stripsMedia(owner, row);
    // A HEIC photo's public copy is a JPEG (see serveSharedFile).
    const name = strips && isHeicType(row.mime ?? "") ? uniqueHeicCopyName(file.name, taken) : file.name;
    taken.add(name);
    entries.push({
      name,
      open: strips ? async () => (await publicImage(driver, location, row)).open() : () => driver.createReadStream(location),
    });
  }
  if (skipped.length > 0) entries.push({ name: `${job.title}/Not included.txt`, open: async () => Readable.from([Buffer.from(skippedNote(skipped))]) });
  addTraffic(db(), owner.id, bytes, new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
  if (!link.isOwner) countLinkTraffic(job.capped, bytes, now);
  // A busy folder, or a busy file going into the zip, slows it down like a single download.
  const throttled = job.throttledTop || plan.files.some((file) => file.skip === null && busy.get(file.row.id)?.level === BUSY.throttled);
  return zipResponse(entries, zipName([{ name: job.title, folder: true }], job.title), { bytesPerSecond: throttled ? SHARE.throttledBytesPerSec : undefined });
}

/** HEAD for "Download all": the same checks as the zip (its size too), without building or counting it. */
export async function checkSharedFolder(linkId: string, folderId: string, viewer: ShareViewer, client: Pick<ClientInfo, "ipKey">): Promise<Response> {
  if ((await countInWindow(`zipcheck:${client.ipKey}`, SHARE.zipCheckWindowSec)) > SHARE.zipChecksPerAddress) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", { retryAfter: SHARE.zipCheckWindowSec });
  }
  const now = Date.now();
  const link = await openLink(linkId, viewer, now);
  if (link.kind === "collection" && folderId === link.collection.id) {
    if (link.collection.access === "STREAM") throw new ApiError("FORBIDDEN", "Downloads are disabled for this link.");
    await assertCollectionZippable(await collectionEntries(link, now), now);
  } else await assertSharedFolderZippable(await resolveSharedFolder(link, folderId, now), now);
  return new Response(null, { status: 200, headers: { "content-type": "application/zip", "cache-control": "private, no-store" } });
}
