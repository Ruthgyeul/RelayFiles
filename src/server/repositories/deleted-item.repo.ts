import "server-only";
import { z } from "zod";
import type { DbClient, Prisma } from "../db/client";
import type { Node } from "../db/generated/client";
import { Access, FileKind, NodeType, Visibility } from "../db/generated/enums";

// "Recently deleted" (docs/architecture.md "휴지통"): deleted items with the Node rows to put back.

/**
 * One Node row as a deleted item keeps it: every column needed to insert it again with the same
 * id, link and share settings. Not kept: the account (the DeletedItem's), generated-file flags
 * (hasThumb, hasDerived, stripFailed: the files are removed on delete and made again after a
 * restore) and updatedAt (the restore time). A column added to Node later is missing from older
 * snapshots and takes its default on restore.
 */
const snapshotRowSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: z.enum(NodeType),
  name: z.string(),
  kind: z.enum(FileKind).nullable(),
  mime: z.string().nullable(),
  /** Bytes as a decimal string (JSON has no bigint). */
  size: z.string().regex(/^\d+$/),
  sha256: z.string().nullable(),
  missing: z.boolean(),
  linkId: z.string(),
  visibility: z.enum(Visibility),
  expiryLabel: z.string(),
  expAt: z.iso.datetime().nullable(),
  burn: z.boolean(),
  downloadLimit: z.number().int().nullable(),
  passwordHash: z.string().nullable(),
  access: z.enum(Access),
  note: z.string(),
  dlPaused: z.boolean(),
  downloads: z.number().int(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime().nullable(),
  takenAt: z.iso.datetime().nullable(),
});
type SnapshotRow = z.infer<typeof snapshotRowSchema>;
const snapshotSchema = z.array(snapshotRowSchema).min(1);

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The rows of a deleted tree as stored in DeletedItem.nodes (parents before children). */
export function toSnapshot(rows: readonly Node[]): Prisma.InputJsonValue {
  return rows.map(
    (row): SnapshotRow => ({
      id: row.id,
      parentId: row.parentId,
      type: row.type,
      name: row.name,
      kind: row.kind,
      mime: row.mime,
      size: row.size.toString(),
      sha256: row.sha256,
      missing: row.missing,
      linkId: row.linkId,
      visibility: row.visibility,
      expiryLabel: row.expiryLabel,
      expAt: iso(row.expAt),
      burn: row.burn,
      downloadLimit: row.downloadLimit,
      passwordHash: row.passwordHash,
      access: row.access,
      note: row.note,
      dlPaused: row.dlPaused,
      downloads: row.downloads,
      tags: row.tags,
      createdAt: row.createdAt.toISOString(),
      modifiedAt: iso(row.modifiedAt),
      takenAt: iso(row.takenAt),
    }),
  );
}

const date = (value: string | null) => (value === null ? null : new Date(value));

/** The Node rows to insert for a restore of `accountId`'s item, generated-file flags cleared. */
export function fromSnapshot(nodes: Prisma.JsonValue, accountId: string, now: Date): Prisma.NodeCreateManyInput[] {
  return snapshotSchema.parse(nodes).map((row) => ({
    ...row,
    accountId,
    size: BigInt(row.size),
    expAt: date(row.expAt),
    createdAt: new Date(row.createdAt),
    modifiedAt: date(row.modifiedAt),
    takenAt: date(row.takenAt),
    hasThumb: false,
    hasDerived: false,
    stripFailed: false,
    updatedAt: now,
  }));
}

/** Full rows of these nodes (every column, for a snapshot), in no particular order. */
export function nodeRowsByIds(db: DbClient, ids: readonly string[]): Promise<Node[]> {
  return db.node.findMany({ where: { id: { in: [...ids] } } });
}

export interface NewDeletedItem {
  id: string;
  accountId: string;
  volumeId: string;
  trashPath: string;
  trashedBytesId: string | null;
  name: string;
  type: Node["type"];
  kind: Node["kind"];
  size: bigint;
  itemCount: number;
  originalParentId: string | null;
  originalPath: string[];
  deletedAt: Date;
  nodes: Prisma.InputJsonValue;
}

/** Keeps deleted items under "Recently deleted" (one statement for all of them). */
export async function createDeletedItems(db: DbClient, data: readonly NewDeletedItem[]): Promise<void> {
  if (data.length > 0) await db.deletedItem.createMany({ data: [...data] });
}

/** What "Recently deleted" lists (without the snapshot). */
const LIST_SELECT = {
  id: true,
  name: true,
  type: true,
  kind: true,
  size: true,
  itemCount: true,
  originalPath: true,
  deletedAt: true,
} as const;

/** An account's deleted items, newest first. */
export function listDeletedItems(db: DbClient, accountId: string, take: number) {
  return db.deletedItem.findMany({ where: { accountId }, select: LIST_SELECT, orderBy: [{ deletedAt: "desc" }, { id: "asc" }], take });
}

/** One deleted item of an account, with its snapshot; null for another account's. */
export function findDeletedItem(db: DbClient, accountId: string, id: string) {
  return db.deletedItem.findFirst({ where: { id, accountId } });
}

/**
 * Removes a deleted item of an account inside a transaction and tells whether it was still
 * there: the row lock makes a second restore (or a delete forever) of the same item wait for
 * the first one and then find nothing.
 */
export async function takeDeletedItem(tx: DbClient, accountId: string, id: string): Promise<boolean> {
  const { count } = await tx.deletedItem.deleteMany({ where: { id, accountId } });
  return count === 1;
}

/**
 * Forgets deleted items moved to the trash before `before` on the volumes whose trash the daily
 * job just emptied (the same rule as forgetTrashedBefore): their files are gone. Items in the
 * trash of a volume that was skipped (READONLY, OFFLINE) can still be restored.
 */
export async function forgetDeletedBefore(db: DbClient, before: Date, volumeIds: readonly string[]): Promise<number> {
  if (volumeIds.length === 0) return 0;
  const { count } = await db.deletedItem.deleteMany({ where: { deletedAt: { lt: before }, volumeId: { in: [...volumeIds] } } });
  return count;
}

/** Which of these link ids some node holds now (a restore gives those rows a new link). */
export async function takenLinkIds(db: DbClient, linkIds: readonly string[]): Promise<Set<string>> {
  if (linkIds.length === 0) return new Set();
  const rows = await db.node.findMany({ where: { linkId: { in: [...linkIds] } }, select: { linkId: true } });
  return new Set(rows.map((row) => row.linkId));
}
