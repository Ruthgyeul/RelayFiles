import "server-only";
import { SEARCH, STORAGE } from "@/config/policy";
import type { CreatedFolder, FolderNode, FolderView, NodeItem, NodeProperties, TaggedItem, Visibility } from "@/contracts/nodes";
import { newLinkId, newNodeId } from "@/domain/ids";
import { nameError, uniqName } from "@/domain/names";
import { parseSearchQuery, rankByName } from "@/domain/search";
import { busyBadge } from "@/domain/share";
import { effectiveVisibility } from "@/domain/tree";
import type { AccountRow } from "../repositories/account.repo";
import { db, Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import {
  ancestorChain,
  childCounts,
  createFolderNode,
  descendantCounts,
  findByName,
  findByTags,
  findNode,
  findRootFolder,
  folderSizes,
  listChildren,
  listFolders,
  listSiblingNames,
  recentFiles,
  tagUsage,
  type NodeRow,
} from "../repositories/node.repo";
import { busyLevels } from "../share/busy";
import { withStorageTransaction } from "../storage/storage-transaction";
import { driverForAccount } from "./volume.service";

/** Tag searches return at most this many items. */
const TAG_SEARCH_LIMIT = 500;

const VISIBILITY: Record<NodeRow["visibility"], Visibility> = { INHERIT: "inherit", PRIVATE: "private", PUBLIC: "public" };

export function toNodeItem(row: NodeRow, extra: { size?: bigint; itemCount?: number; fileCount?: number } = {}): NodeItem {
  return {
    id: row.id,
    type: row.type === "FOLDER" ? "folder" : "file",
    name: row.name,
    kind: row.kind ? (row.kind.toLowerCase() as NodeItem["kind"]) : null,
    size: (extra.size ?? row.size).toString(),
    createdAt: row.createdAt.toISOString(),
    downloads: row.downloads,
    itemCount: extra.itemCount ?? 0,
    fileCount: extra.fileCount ?? (row.type === "FILE" ? 1 : 0),
    tags: row.tags,
    linkId: row.linkId,
    hasThumb: row.hasThumb,
    settings: {
      visibility: VISIBILITY[row.visibility],
      expiry: row.expiryLabel,
      expAt: row.expAt?.toISOString() ?? null,
      burn: row.burn,
      downloadLimit: row.downloadLimit,
      hasPassword: row.passwordHash !== null,
      access: row.access === "STREAM" ? "stream" : "both",
      note: row.note,
      dlPaused: row.dlPaused,
    },
    busy: null,
  };
}

/** Adds folder sizes and child counts to listed rows. */
async function withFolderStats(rows: NodeRow[]): Promise<NodeItem[]> {
  const folderIds = rows.filter((row) => row.type === "FOLDER").map((row) => row.id);
  const now = Date.now();
  const [counts, sizes, busy] = await Promise.all([childCounts(db(), folderIds), folderSizes(db(), folderIds), busyLevels(rows, now)]);
  return rows.map((row) => {
    const stats = sizes.get(row.id);
    const item = row.type === "FOLDER" ? toNodeItem(row, { size: stats?.size ?? 0n, fileCount: stats?.files ?? 0, itemCount: counts.get(row.id) ?? 0 }) : toNodeItem(row);
    const level = busy.get(row.id);
    return level ? { ...item, busy: busyBadge(level, now, "app") } : item;
  });
}

/** Resolves "root" or a folder id owned by the account; other accounts' folders are 404. */
async function resolveFolder(accountId: string, ref: string): Promise<NodeRow> {
  const row = ref === "root" ? await findRootFolder(db(), accountId) : await findNode(db(), accountId, ref);
  if (!row || row.type !== "FOLDER") throw new ApiError("NOT_FOUND");
  return row;
}

export async function getFolderView(accountId: string, ref: string): Promise<FolderView> {
  const folder = await resolveFolder(accountId, ref);
  const [chain, children, [stats]] = await Promise.all([ancestorChain(db(), folder.id), listChildren(db(), folder.id), withFolderStats([folder])]);
  return {
    folder: stats!,
    isRoot: folder.parentId === null,
    path: chain.map(({ id, name }) => ({ id, name })),
    effectiveVisibility: effectiveVisibility(chain.map((row) => VISIBILITY[row.visibility]).reverse()),
    parentVisibility: effectiveVisibility(chain.slice(0, -1).map((row) => VISIBILITY[row.visibility]).reverse()),
    children: await withFolderStats(children),
  };
}

/** Everything the Properties dialog shows about one item. */
export async function getProperties(accountId: string, nodeId: string): Promise<NodeProperties> {
  const row = await findNode(db(), accountId, nodeId);
  if (!row) throw new ApiError("NOT_FOUND");
  const folder = row.type === "FOLDER";
  const [chain, [item], contains] = await Promise.all([ancestorChain(db(), row.id), withFolderStats([row]), folder ? descendantCounts(db(), row.id) : Promise.resolve(null)]);
  return {
    item: item!,
    isRoot: row.parentId === null,
    location: chain.slice(0, -1).map((ancestor) => ancestor.name),
    effectiveVisibility: effectiveVisibility(chain.map((ancestor) => VISIBILITY[ancestor.visibility]).reverse()),
    contains,
  };
}

/** Adds the folder path ("Videos / 2024") to each hit, keeping the order. */
async function withPaths(accountId: string, rows: NodeRow[]): Promise<TaggedItem[]> {
  const [folders, items] = await Promise.all([listFolders(db(), accountId), withFolderStats(rows)]);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathOf = (parentId: string | null): string => {
    const names: string[] = [];
    for (let folder = parentId ? byId.get(parentId) : undefined; folder; folder = folder.parentId ? byId.get(folder.parentId) : undefined) names.unshift(folder.name);
    return names.join(" / ");
  };
  return items.map((item, index) => {
    const parentId = rows[index]!.parentId ?? "root";
    return { ...item, parentPath: pathOf(rows[index]!.parentId), parentId, parentIsRoot: byId.get(parentId)?.parentId === null };
  });
}

/** Items anywhere in the account that carry every tag, with their folder path. */
export async function searchByTags(accountId: string, tags: string[]): Promise<TaggedItem[]> {
  return withPaths(accountId, await findByTags(db(), accountId, tags, TAG_SEARCH_LIMIT));
}

/**
 * Global search (Ctrl/⌘ K): recent files for an empty query, items with every tag for
 * "#tag1 #tag2", otherwise names containing the text, best matches first.
 */
export async function searchItems(accountId: string, raw: string): Promise<TaggedItem[]> {
  const query = parseSearchQuery(raw);
  if (query.mode === "recent") return withPaths(accountId, await recentFiles(db(), accountId, SEARCH.recentItems));
  const rows = query.mode === "tags" ? await findByTags(db(), accountId, query.tags, TAG_SEARCH_LIMIT) : await findByName(db(), accountId, query.text, SEARCH.nameCandidates);
  const ranked = rankByName(
    rows.map((row) => ({ row, name: row.name, type: row.type === "FOLDER" ? ("folder" as const) : ("file" as const) })),
    query.mode === "name" ? query.text : "",
  ).slice(0, SEARCH.maxResults);
  return withPaths(accountId, ranked.map(({ row }) => row));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Creates a folder in the database and on the volume together. A taken name gets the next
 * free "Name (2)" variant like the design; the caller is told so it can say so.
 */
export async function createFolder(account: Pick<AccountRow, "id" | "volumeId">, parentRef: string, requested: string): Promise<CreatedFolder> {
  const wanted = requested.trim() || "New folder";
  const error = nameError(wanted);
  if (error) throw new ApiError("BAD_REQUEST", error, { fields: { name: error } });

  const parent = await resolveFolder(account.id, parentRef);
  const chain = await ancestorChain(db(), parent.id);
  if (chain.length >= STORAGE.maxFolderDepth) throw new ApiError("BAD_REQUEST", `Folders can be nested at most ${STORAGE.maxFolderDepth} levels deep.`);
  const driver = await driverForAccount(account, "write");
  // The account root maps to users/<accountId>/, so its own name is not part of the path.
  const parentSegments = chain.slice(1).map((row) => row.name);

  for (let attempt = 0; ; attempt++) {
    const name = uniqName(await listSiblingNames(db(), parent.id), wanted, false);
    try {
      const row = await withStorageTransaction(db(), async (tx, undo) => {
        const created = await createFolderNode(tx, { id: newNodeId(), accountId: account.id, parentId: parent.id, name, linkId: newLinkId() });
        const location = { accountId: account.id, segments: [...parentSegments, name] };
        await driver.createFolder(location);
        undo.push("remove new folder", async () => {
          await driver.moveToTrash(location);
        });
        return created;
      });
      return { folder: toNodeItem(row, { size: 0n, itemCount: 0 }), requestedName: wanted, renamed: name !== wanted };
    } catch (caught) {
      // Another request took the name in between: pick the next free one.
      if (isUniqueViolation(caught) && attempt < 2) continue;
      throw caught;
    }
  }
}

/** Tags in use with counts (tag dialog suggestions). */
export function tagSuggestions(accountId: string) {
  return tagUsage(db(), accountId);
}

/** Every folder of an account (id, name, parent) for the move/copy picker. */
export async function folderTree(accountId: string): Promise<FolderNode[]> {
  const folders = await listFolders(db(), accountId);
  return folders.map(({ id, name, parentId }) => ({ id, name, parentId }));
}
