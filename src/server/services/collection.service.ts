import "server-only";
import { hash } from "@node-rs/argon2";
import { SHARE } from "@/config/policy";
import type { CollectionDto, CreateCollectionInput, UpdateCollectionInput } from "@/contracts/collections";
import { newCollectionId, newLinkId } from "@/domain/ids";
import { isExpiryOption, nextExpiry } from "@/domain/share";
import { db, type DbClient } from "../db/client";
import { ApiError } from "../http/api-error";
import {
  type CollectionWithItems,
  countCollections,
  createCollection,
  deleteCollection,
  findCollection,
  linkIdTaken,
  listCollections,
  setCollectionItems,
  updateCollection,
} from "../repositories/collection.repo";
import { findNodes, type NodeRow } from "../repositories/node.repo";
import { shareUrl } from "../share/share-link";
import type { NodeOwner } from "./node-access";
import { kindOf } from "./node-dto";

/** The account's rows of these items, in the order given; 404 when one is not the account's (or gone). */
async function ownItems(tx: DbClient, owner: NodeOwner, ids: readonly string[]): Promise<NodeRow[]> {
  const unique = [...new Set(ids)];
  const rows = new Map((await findNodes(tx, owner.id, unique)).map((row) => [row.id, row]));
  if (rows.size !== unique.length) throw new ApiError("NOT_FOUND");
  return unique.map((id) => rows.get(id)!);
}

/** A link id nothing else has, not even a link that ended. */
async function freshLinkId(tx: DbClient): Promise<string> {
  for (let attempt = 0; attempt < SHARE.collectionLinkAttempts; attempt++) {
    const linkId = newLinkId();
    if (!(await linkIdTaken(tx, linkId))) return linkId;
  }
  throw new ApiError("CONFLICT", "Try again.");
}

/** Expiry and delete-after-download, which only admins set (members' items go with their account). */
function adminSettings(owner: NodeOwner, input: { expiry?: string; burn?: boolean }, previous: { expiryLabel: string; expAt: Date | null } | null, now: number) {
  if (!owner.isAdmin) return {};
  const data: { expiryLabel?: string; expAt?: Date | null; burn?: boolean } = {};
  if (input.expiry !== undefined) {
    if (!isExpiryOption(input.expiry)) throw new ApiError("BAD_REQUEST", "Unknown expiry.", { fields: { expiry: "Unknown expiry." } });
    const expAt = nextExpiry({ expiry: previous?.expiryLabel ?? "Never", expAt: previous?.expAt?.getTime() ?? null }, input.expiry, now);
    data.expiryLabel = input.expiry;
    data.expAt = expAt === null ? null : new Date(expAt);
  }
  if (input.burn !== undefined) data.burn = input.burn;
  return data;
}

const passwordHashOf = async (password: string) => (password === "" ? null : await hash(password));

function toDto(collection: CollectionWithItems, rows: ReadonlyMap<string, NodeRow>): CollectionDto {
  return {
    id: collection.id,
    linkId: collection.linkId,
    url: shareUrl(collection.linkId),
    name: collection.name,
    note: collection.note,
    expiry: collection.expiryLabel,
    expAt: collection.expAt?.toISOString() ?? null,
    burn: collection.burn,
    downloadLimit: collection.downloadLimit,
    downloads: collection.downloads,
    hasPassword: collection.passwordHash !== null,
    access: collection.access === "STREAM" ? "stream" : "both",
    createdAt: collection.createdAt.toISOString(),
    items: collection.nodeIds.flatMap((id) => {
      const row = rows.get(id);
      return row ? [{ id: row.id, type: row.type === "FOLDER" ? ("folder" as const) : ("file" as const), name: row.name, kind: kindOf(row.kind) }] : [];
    }),
  };
}

/** Collections with the names of their items (one read for all of them). */
async function toDtos(owner: NodeOwner, collections: readonly CollectionWithItems[]): Promise<CollectionDto[]> {
  const rows = await findNodes(db(), owner.id, [...new Set(collections.flatMap((collection) => collection.nodeIds))]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return collections.map((collection) => toDto(collection, byId));
}

/** The account's collections, newest first. */
export async function collectionsOf(owner: NodeOwner): Promise<CollectionDto[]> {
  return toDtos(owner, await listCollections(db(), owner.id));
}

/** A new collection link for some of the account's files and folders, in the order given. */
export async function createCollectionFor(owner: NodeOwner, input: CreateCollectionInput): Promise<CollectionDto> {
  const now = Date.now();
  const passwordHash = await passwordHashOf(input.password);
  const id = await db().$transaction(async (tx) => {
    const items = await ownItems(tx, owner, input.nodeIds);
    if ((await countCollections(tx, owner.id)) >= SHARE.collectionsPerAccount) {
      throw new ApiError("BAD_REQUEST", `An account can have at most ${SHARE.collectionsPerAccount} collections.`);
    }
    const created = await createCollection(tx, {
      id: newCollectionId(),
      accountId: owner.id,
      linkId: await freshLinkId(tx),
      name: input.name,
      note: input.note.trim(),
      downloadLimit: input.downloadLimit,
      passwordHash,
      access: input.access === "stream" ? "STREAM" : "BOTH",
      ...adminSettings(owner, input, null, now),
    });
    await setCollectionItems(
      tx,
      created.id,
      items.map((row) => row.id),
    );
    return created.id;
  });
  return (await toDtos(owner, [(await findCollection(db(), owner.id, id))!]))[0]!;
}

/** Changes a collection's settings or items; another account's collection is 404. */
export async function updateCollectionFor(owner: NodeOwner, id: string, input: UpdateCollectionInput): Promise<CollectionDto> {
  const now = Date.now();
  const passwordHash = input.password === undefined ? undefined : await passwordHashOf(input.password);
  await db().$transaction(async (tx) => {
    const current = await findCollection(tx, owner.id, id);
    if (!current) throw new ApiError("NOT_FOUND");
    if (input.nodeIds) {
      const items = await ownItems(tx, owner, input.nodeIds);
      await setCollectionItems(
        tx,
        id,
        items.map((row) => row.id),
      );
    }
    await updateCollection(tx, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.note !== undefined ? { note: input.note.trim() } : {}),
      ...(input.downloadLimit !== undefined ? { downloadLimit: input.downloadLimit } : {}),
      ...(passwordHash !== undefined ? { passwordHash } : {}),
      ...(input.access !== undefined ? { access: input.access === "stream" ? "STREAM" : "BOTH" } : {}),
      ...adminSettings(owner, input, current, now),
    });
  });
  return (await toDtos(owner, [(await findCollection(db(), owner.id, id))!]))[0]!;
}

/** Deletes a collection: its link stops working at once, its items are not touched. */
export async function deleteCollectionFor(owner: NodeOwner, id: string): Promise<{ deleted: true }> {
  if ((await deleteCollection(db(), owner.id, id)) === 0) throw new ApiError("NOT_FOUND");
  return { deleted: true };
}
