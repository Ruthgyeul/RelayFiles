import "server-only";
import { FILES } from "@/config/policy";
import type { SearchKind } from "@/domain/search";
import type { DbClient, Prisma } from "../db/client";

/** Name of every account's root folder; it maps to users/<accountId>/ on the volume. */
const ROOT_FOLDER_NAME = "root";

export async function createRootFolder(db: DbClient, data: { id: string; accountId: string; linkId: string }): Promise<void> {
  await db.node.create({ data: { ...data, parentId: null, type: "FOLDER", name: ROOT_FOLDER_NAME } });
}

/** Columns the File Manager shows (password hash only as a flag). */
export const NODE_SELECT = {
  id: true,
  accountId: true,
  parentId: true,
  type: true,
  name: true,
  kind: true,
  mime: true,
  size: true,
  sha256: true,
  hasThumb: true,
  hasDerived: true,
  scanState: true,
  linkId: true,
  visibility: true,
  expiryLabel: true,
  expAt: true,
  burn: true,
  downloadLimit: true,
  dailyBytesCap: true,
  passwordHash: true,
  access: true,
  note: true,
  dlPaused: true,
  downloads: true,
  tags: true,
  createdAt: true,
  modifiedAt: true,
} as const;

export type NodeRow = NonNullable<Awaited<ReturnType<typeof findNode>>>;

export function findNode(db: DbClient, accountId: string, nodeId: string) {
  return db.node.findFirst({ where: { id: nodeId, accountId }, select: NODE_SELECT });
}

/** A node by id for background jobs (no account scope: the caller is the server itself). */
export function findNodeForJob(db: DbClient, nodeId: string) {
  return db.node.findUnique({ where: { id: nodeId }, select: NODE_SELECT });
}

export function findRootFolder(db: DbClient, accountId: string) {
  return db.node.findFirst({ where: { accountId, parentId: null }, select: NODE_SELECT });
}

export function listChildren(db: DbClient, parentId: string) {
  return db.node.findMany({ where: { parentId }, select: NODE_SELECT });
}

export function listSiblingNames(db: DbClient, parentId: string): Promise<string[]> {
  return db.node.findMany({ where: { parentId }, select: { name: true } }).then((rows) => rows.map((row) => row.name));
}

/** Nodes carrying every tag, anywhere in the account (the root never has tags). */
export function findByTags(db: DbClient, accountId: string, tags: string[], limit: number) {
  return db.node.findMany({ where: { accountId, parentId: { not: null }, tags: { hasEvery: tags } }, select: NODE_SELECT, take: limit });
}

/**
 * Items that may be open from outside: public, or with a password, download limit, expiry,
 * first-download delete or paused downloads of their own ("Shared by me" decides which count).
 * Newest first; a replaced file's row stepping aside (a name with "/") is left out.
 */
export function sharedCandidates(db: DbClient, accountId: string, limit: number) {
  return db.node.findMany({
    where: {
      accountId,
      NOT: { name: { contains: "/" } },
      OR: [{ visibility: "PUBLIC" }, { passwordHash: { not: null } }, { downloadLimit: { not: null } }, { expAt: { not: null } }, { burn: true }, { dlPaused: true }],
    },
    select: NODE_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
  });
}

/** Makes items of one account private; returns how many it changed (fewer: some are not the account's). */
export async function makeNodesPrivate(db: DbClient, accountId: string, ids: readonly string[]): Promise<number> {
  const { count } = await db.node.updateMany({ where: { accountId, id: { in: [...ids] } }, data: { visibility: "PRIVATE" } });
  return count;
}

/** What a global search asks for (domain/search.ts), with its ages as dates. */
export interface NodeSearch {
  text: string;
  tags: string[];
  /** "folder" or file kinds; empty: any. */
  kinds: SearchKind[];
  /** Date modified (date added without one) on or after this. */
  newerThan: Date | null;
  /** Date modified (date added without one) before this. */
  olderThan: Date | null;
}

const KIND_TO_DB = { video: "VIDEO", audio: "AUDIO", image: "IMAGE", other: "OTHER" } as const;

/** The date-modified rule of a search: modifiedAt, or createdAt where a row has none (folders). */
function modifiedWhere(op: "gte" | "lt", at: Date) {
  return { OR: [{ modifiedAt: { [op]: at } }, { modifiedAt: null, createdAt: { [op]: at } }] };
}

/** Items (not the root) matching every part of a search; the name part uses the trigram index. */
export function searchNodes(db: DbClient, accountId: string, search: NodeSearch, limit: number) {
  const fileKinds = search.kinds.flatMap((kind) => (kind === "folder" ? [] : [KIND_TO_DB[kind]]));
  const and = [
    ...(search.kinds.length ? [{ OR: [...(search.kinds.includes("folder") ? [{ type: "FOLDER" as const }] : []), ...(fileKinds.length ? [{ type: "FILE" as const, kind: { in: fileKinds } }] : [])] }] : []),
    ...(search.newerThan ? [modifiedWhere("gte", search.newerThan)] : []),
    ...(search.olderThan ? [modifiedWhere("lt", search.olderThan)] : []),
  ];
  return db.node.findMany({
    where: {
      accountId,
      parentId: { not: null },
      ...(search.text ? { name: { contains: search.text, mode: "insensitive" as const } } : {}),
      ...(search.tags.length ? { tags: { hasEvery: search.tags } } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    select: NODE_SELECT,
    take: limit,
  });
}

export function setScanState(db: DbClient, nodeId: string, scanState: "PENDING" | "CLEAN" | "FAILED", only?: "PENDING") {
  return db.node.updateMany({ where: { id: nodeId, ...(only ? { scanState: only } : {}) }, data: { scanState } });
}

/** The newest files of an account. */
export function recentFiles(db: DbClient, accountId: string, limit: number) {
  return db.node.findMany({ where: { accountId, type: "FILE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: NODE_SELECT, take: limit });
}

/** Every folder of an account (id, name, parent): the move/copy picker. */
export function listFolders(db: DbClient, accountId: string) {
  return db.node.findMany({ where: { accountId, type: "FOLDER" }, select: { id: true, name: true, parentId: true, visibility: true } });
}

/** Direct child counts for folders. */
export async function childCounts(db: DbClient, parentIds: string[]): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await db.node.groupBy({ by: ["parentId"], where: { parentId: { in: parentIds } }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.parentId!, row._count._all]));
}

export interface NewFolder {
  id: string;
  accountId: string;
  parentId: string;
  name: string;
  linkId: string;
}

export function createFolderNode(db: DbClient, data: NewFolder) {
  return db.node.create({ data: { ...data, type: "FOLDER" }, select: NODE_SELECT });
}

export function findNodes(db: DbClient, accountId: string, ids: string[]) {
  return db.node.findMany({ where: { accountId, id: { in: ids } }, select: NODE_SELECT });
}

/** {@link findNodes} for any number of ids, FILES.idsPerQuery per query. */
export async function findNodesMany(db: DbClient, accountId: string, ids: readonly string[]): Promise<NodeRow[]> {
  const rows: NodeRow[] = [];
  for (let start = 0; start < ids.length; start += FILES.idsPerQuery) rows.push(...(await findNodes(db, accountId, ids.slice(start, start + FILES.idsPerQuery))));
  return rows;
}

export function updateNode(db: DbClient, nodeId: string, data: Prisma.NodeUpdateInput) {
  return db.node.update({ where: { id: nodeId }, data, select: NODE_SELECT });
}

/** Sets the tags of many of an account's items in one statement (each row gets its own list). */
export async function setTagsEach(db: DbClient, accountId: string, rows: readonly { id: string; tags: readonly string[] }[]): Promise<void> {
  if (rows.length === 0) return;
  await db.$executeRaw`
    UPDATE "Node" AS n SET tags = ARRAY(SELECT jsonb_array_elements_text(v.tags)), "updatedAt" = now()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(id text, tags jsonb)
    WHERE n.id = v.id AND n."accountId" = ${accountId}`;
}

export async function deleteNodes(db: DbClient, ids: string[]): Promise<void> {
  await db.node.deleteMany({ where: { id: { in: ids } } });
}

export async function insertNodes(db: DbClient, rows: Prisma.NodeCreateManyInput[]): Promise<void> {
  await db.node.createMany({ data: rows });
}

/** A child with this exact name, if any. */
export function findChildByName(db: DbClient, parentId: string, name: string) {
  return db.node.findFirst({ where: { parentId, name }, select: NODE_SELECT });
}

/** Marks files found missing on disk (or found again). */
export async function setMissing(db: DbClient, ids: readonly string[], missing: boolean): Promise<void> {
  if (ids.length === 0) return;
  await db.node.updateMany({ where: { id: { in: [...ids] }, type: "FILE" }, data: { missing } });
}

/** What a file keeps when its content is replaced: its share link, the link's settings and tags. */
export type CarriedSettings = Pick<NodeRow, "linkId" | "visibility" | "expiryLabel" | "expAt" | "burn" | "downloadLimit" | "dailyBytesCap" | "passwordHash" | "access" | "note" | "dlPaused" | "downloads" | "tags">;

export const carriedSettingsOf = (row: NodeRow): CarriedSettings => ({
  linkId: row.linkId,
  visibility: row.visibility,
  expiryLabel: row.expiryLabel,
  expAt: row.expAt,
  burn: row.burn,
  downloadLimit: row.downloadLimit,
  dailyBytesCap: row.dailyBytesCap,
  passwordHash: row.passwordHash,
  access: row.access,
  note: row.note,
  dlPaused: row.dlPaused,
  downloads: row.downloads,
  tags: row.tags,
});

export interface NewFile extends Partial<CarriedSettings> {
  id: string;
  accountId: string;
  parentId: string;
  name: string;
  kind: "VIDEO" | "AUDIO" | "IMAGE" | "OTHER";
  mime: string;
  size: bigint;
  /** Null only for content restored from a version kept before hashes were recorded. */
  sha256: string | null;
  linkId: string;
  /** The file's own modification time (the uploader's File.lastModified, or the upload time). */
  modifiedAt: Date;
  /** PENDING for a file received through an upload-only link while scanning is on. */
  scanState?: "PENDING";
}

export function createFileNode(db: DbClient, data: NewFile) {
  return db.node.create({ data: { ...data, type: "FILE" }, select: NODE_SELECT });
}

/** Items past their own expiry, or delete-after-download items that were downloaded. */
export function expiredItemIds(db: DbClient, accountId: string | null, now: Date) {
  return db.node.findMany({
    where: { ...(accountId ? { accountId } : {}), parentId: { not: null }, OR: [{ expAt: { lte: now } }, { burn: true, downloads: { gte: 1 } }] },
    select: { id: true, accountId: true },
  });
}

/** A file of the account with this content and size, other than `exceptId` (deduplication of a re-upload). */
export function findFileWithContent(db: DbClient, accountId: string, sha256: string, size: bigint, exceptId: string | null) {
  return db.node.findFirst({
    where: { accountId, type: "FILE", sha256, size, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

/** Direct children with what "Renumber files" sorts and checks by. */
export function listChildrenForRenumber(db: DbClient, parentId: string) {
  return db.node.findMany({ where: { parentId }, select: { id: true, name: true, type: true, createdAt: true, modifiedAt: true, takenAt: true, missing: true } });
}

/**
 * Serializes renumbering runs of one folder inside a transaction: a second run waits for the
 * first to commit, then plans again from the names it left.
 */
export async function lockFolderForRenumber(tx: DbClient, folderId: string): Promise<void> {
  const key = `renumber:${folderId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Files in these folders with their content hash, for "Find duplicates" (at most `take`). */
export function filesInFolders(db: DbClient, accountId: string, folderIds: string[], take: number) {
  return db.node.findMany({
    where: { accountId, type: "FILE", parentId: { in: folderIds } },
    select: { id: true, name: true, parentId: true, kind: true, size: true, sha256: true, hasThumb: true, createdAt: true, modifiedAt: true },
    orderBy: { id: "asc" },
    take,
  });
}

/**
 * Renames many children of one folder in a single statement (renumbering) and returns how many
 * rows changed (fewer when one was deleted or moved meanwhile). Each new name must be free when
 * its row is written: the unique index is checked row by row.
 */
export async function renameChildren(tx: DbClient, folderId: string, renames: readonly { id: string; name: string }[]): Promise<number> {
  if (renames.length === 0) return 0;
  const ids = renames.map((rename) => rename.id);
  const names = renames.map((rename) => rename.name);
  return tx.$executeRaw`
    UPDATE "Node" AS n SET name = v.name, "updatedAt" = now()
    FROM unnest(${ids}::text[], ${names}::text[]) AS v(id, name)
    WHERE n.id = v.id AND n."parentId" = ${folderId}`;
}

/**
 * Moves items of an account into a folder under new names, in one statement. Returns how many
 * moved (fewer when an item is gone); a taken name fails on the (parentId, name) unique index.
 */
export async function moveIntoFolder(tx: DbClient, accountId: string, folderId: string, moves: readonly { id: string; name: string }[]): Promise<number> {
  if (moves.length === 0) return 0;
  const ids = moves.map((move) => move.id);
  const names = moves.map((move) => move.name);
  return tx.$executeRaw`
    UPDATE "Node" AS n SET "parentId" = ${folderId}, name = v.name, "updatedAt" = now()
    FROM unnest(${ids}::text[], ${names}::text[]) AS v(id, name)
    WHERE n.id = v.id AND n."accountId" = ${accountId}`;
}
