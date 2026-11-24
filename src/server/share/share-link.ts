import "server-only";
import { getAppEnv, getEnv } from "@/config/env";
import { deletionDate } from "@/domain/account";
import { collectionItemIndex, collectionItemOpen, type CollectionGuardRow } from "@/domain/collection";
import { shareStatus, strictestGuard, type Busy, type ShareStatus, type StrictestGuard } from "@/domain/share";
import { downloadBlock, type DownloadBlock } from "@/domain/share-access";
import { downloadsUsedUp } from "@/domain/share-limits";
import { effectiveVisibility } from "@/domain/tree";
import { cookieSecrets } from "../auth/keys";
import { db } from "../db/client";
import { findAccountById, type AccountRow } from "../repositories/account.repo";
import { findCollectionByLinkId, type CollectionWithItems } from "../repositories/collection.repo";
import type { NodeRow } from "../repositories/node.repo";
import { findByLinkId, sharedChain, type ChainRow, type SharedRow } from "../repositories/share.repo";
import { isUnlocked, type Unlocks } from "./unlock-cookie";
import { kindOf as kindOfValue, VISIBILITY } from "../services/node-dto";

/** Who is looking at a share link. */
export interface ShareViewer {
  /** Accounts signed in on this device (the owner sees the visitor preview bar). */
  accountIds: readonly string[];
  unlocks: Unlocks;
  /** The browser's share visitor id (`rf_dv`), which resumed downloads are granted to. */
  visitorId: string | null;
}

export const lower = <T extends string>(value: T) => value.toLowerCase() as Lowercase<T>;
/** The DTO kind of a node row ("IMAGE" → "image"), or null for folders. */
export const kindOf = (row: Pick<NodeRow, "kind">) => kindOfValue(row.kind);

export const shareUrl = (linkId: string) => `${getAppEnv().PUBLIC_URL}/d/${linkId}`;

/** The status of a link from its own facts and the strictest guard on the way to it. */
function linkStatus(guard: StrictestGuard, own: { burn: boolean; downloads: number; downloadLimit: number | null }, visibility: "private" | "public", now: number): ShareStatus {
  if (guard.burnUsed) return "expired";
  return shareStatus(
    { expAt: guard.expAt, burn: own.burn, downloads: own.downloads, downloadLimit: own.downloadLimit, effectiveVisibility: visibility, hasPassword: guard.hasPassword, unlocked: guard.unlocked },
    now,
  );
}

const accountDeletesAt = (owner: AccountRow) => deletionDate(owner, getEnv("policy").ACCOUNT_TTL_DAYS)?.getTime() ?? null;

/**
 * A link's settings, owner and status. Null when no item or collection has this link. The status
 * follows the strictest settings from the account root down to the shared item
 * (`strictestGuard`): a folder above it that expired, was downloaded once as
 * delete-after-download or has a password closes or locks this link too, and so does the
 * owner's account reaching its deletion date.
 */
export async function loadLink(linkId: string, viewer: ShareViewer, now: number): Promise<LoadedLink | null> {
  const root = await findByLinkId(db(), linkId);
  if (!root) return loadCollectionLink(linkId, viewer, now);
  const [chain, owner] = await Promise.all([sharedChain(db(), root.id), findAccountById(db(), root.accountId)]);
  if (!owner) return null;
  const visibility = effectiveVisibility(chain.map((row) => VISIBILITY[row.visibility]).reverse());
  const guard = strictestGuard(
    chain.map((row) => ({
      expAt: row.expAt?.getTime() ?? null,
      burn: row.burn,
      downloads: row.downloads,
      hasPassword: row.passwordHash !== null,
      unlocked: isUnlocked(viewer.unlocks, row.linkId, row.passwordHash, cookieSecrets()),
    })),
    accountDeletesAt(owner),
  );
  const status = linkStatus(guard, root, visibility, now);
  const isOwner = viewer.accountIds.includes(root.accountId);
  // To anyone but its owner a private link is "private" whatever else is true of it, and every
  // caller answers that as a link that does not exist: an "expired" or "limit reached" card (or
  // a 410/403, or an argon2 check on unlock) would tell someone guessing ids they found a real one.
  // The owner keeps the design's order and sees why the link is closed.
  return { kind: "node", root, chain, owner, status: !isOwner && visibility !== "public" ? "private" : status, isOwner };
}

/** A collection link: public while it exists, with its own expiry, limits and password. */
async function loadCollectionLink(linkId: string, viewer: ShareViewer, now: number): Promise<CollectionLink | null> {
  const collection = await findCollectionByLinkId(db(), linkId);
  if (!collection) return null;
  const owner = await findAccountById(db(), collection.accountId);
  if (!owner) return null;
  const guard = strictestGuard(
    [
      {
        expAt: collection.expAt?.getTime() ?? null,
        burn: collection.burn,
        downloads: collection.downloads,
        hasPassword: collection.passwordHash !== null,
        unlocked: isUnlocked(viewer.unlocks, collection.linkId, collection.passwordHash, cookieSecrets()),
      },
    ],
    accountDeletesAt(owner),
  );
  return { kind: "collection", collection, items: new Set(collection.nodeIds), owner, status: linkStatus(guard, collection, "public", now), isOwner: viewer.accountIds.includes(collection.accountId) };
}

interface LinkBase {
  owner: AccountRow;
  status: ShareStatus;
  isOwner: boolean;
}

/** The link of one file or folder (Node.linkId), with the chain from the account root down to it. */
export type NodeLink = LinkBase & { kind: "node"; root: NodeRow; chain: ChainRow[] };
/** A collection link; `items` holds the ids of its files and folders. */
export type CollectionLink = LinkBase & { kind: "collection"; collection: CollectionWithItems; items: ReadonlySet<string> };
export type LoadedLink = NodeLink | CollectionLink;

/** The id downloads through a collection link are counted on as well (null for an item's own link). */
export const collectionIdOf = (link: LoadedLink): string | null => (link.kind === "collection" ? link.collection.id : null);

/** An item below the link that visitors of the link may not reach: private, protected by its own password, or expired. */
const closedBelowLink = (row: ChainRow, now: number) => row.visibility === "PRIVATE" || row.passwordHash !== null || (row.expAt !== null && row.expAt.getTime() <= now);

/** The chain from the account root down to an item (a node link's own chain is already loaded). */
export const chainTo = (link: LoadedLink, nodeId: string): Promise<ChainRow[]> => (link.kind === "node" && nodeId === link.root.id ? Promise.resolve(link.chain) : sharedChain(db(), nodeId));

/**
 * The rows from the link's item down to the last row of `chain`, or null when that row is not
 * inside the link or something between them is closed to visitors (as in publicTree).
 */
export function trailInLink(chain: readonly ChainRow[], rootId: string, now: number): ChainRow[] | null {
  const rootAt = chain.findIndex((at) => at.id === rootId);
  if (rootAt < 0 || chain.slice(rootAt + 1).some((at) => closedBelowLink(at, now))) return null;
  return chain.slice(rootAt);
}

/** The rows of a collection item's chain as `collectionItemOpen` reads them. */
export const collectionGuardRows = (chain: readonly ChainRow[]): CollectionGuardRow[] =>
  chain.map((row) => ({ id: row.id, hasPassword: row.passwordHash !== null, expAt: row.expAt?.getTime() ?? null, burn: row.burn, downloads: row.downloads }));

/**
 * The rows from the shared item down to the last row of `chain`, or null when that row is not
 * reachable through the link: outside it, closed to visitors below the shared item, or (in a
 * collection) behind a password, expiry or used delete-after-download item above the collection item.
 */
export function linkTrail(link: LoadedLink, chain: readonly ChainRow[], now: number): ChainRow[] | null {
  if (link.kind === "node") return trailInLink(chain, link.root.id, now);
  const start = collectionItemIndex(chain, link.items);
  if (start < 0 || !collectionItemOpen(collectionGuardRows(chain.slice(0, start + 1)), now)) return null;
  return trailInLink(chain, chain[start]!.id, now);
}

/**
 * Stream only, paused downloads and used-up download limits on the items above a row, from the
 * account root down to its parent. Like passwords and expiry (`strictestGuard`), a folder's
 * setting applies to everything inside it, whichever link the item is opened through (every
 * download below a limiting folder is counted there, `claimDownload`).
 */
export interface WayAbove {
  streamOnly: boolean;
  dlPaused: boolean;
  limitUsed: boolean;
}

type WayRow = Pick<SharedRow, "access" | "dlPaused" | "downloadLimit" | "downloads" | "burn">;
const NOTHING_ABOVE: WayAbove = { streamOnly: false, dlPaused: false, limitUsed: false };
export const through = (way: WayAbove, row: WayRow): WayAbove => ({
  streamOnly: way.streamOnly || row.access === "STREAM",
  dlPaused: way.dlPaused || row.dlPaused,
  limitUsed: way.limitUsed || downloadsUsedUp(row),
});

/** The way above the last row of a chain (account root first). */
export const wayAboveEnd = (chain: readonly WayRow[]) => chain.slice(0, -1).reduce(through, NOTHING_ABOVE);

/** {@link wayAboveEnd} through a link: a stream-only collection makes everything in it stream only. */
export function linkWayAbove(link: LoadedLink, chain: readonly WayRow[]): WayAbove {
  const way = wayAboveEnd(chain);
  return link.kind === "collection" && link.collection.access === "STREAM" ? { ...way, streamOnly: true } : way;
}

/** The way above each row of a tree read from `top` down, starting from the way above `top`. */
export function wayAboveInTree(top: SharedRow, aboveTop: WayAbove, byId: ReadonlyMap<string, SharedRow>): (row: SharedRow) => WayAbove {
  const known = new Map<string, WayAbove>([[top.id, aboveTop]]);
  const wayAbove = (row: SharedRow): WayAbove => {
    const cached = known.get(row.id);
    if (cached) return cached;
    const parent = byId.get(row.parentId ?? "");
    const way = parent ? through(wayAbove(parent), parent) : aboveTop;
    known.set(row.id, way);
    return way;
  };
  return wayAbove;
}

/** Whether downloads of a row are paused by an admin, on it or on a folder above it. */
export const pausedOn = (row: WayRow, above: WayAbove) => row.dlPaused || above.dlPaused;

/** Why visitors may not download this row now (null = they may), as on the share page. */
export function downloadBlockOf(row: SharedRow, above: WayAbove, busy: Busy | undefined): DownloadBlock | null {
  return downloadBlock({
    linkStreamOnly: above.streamOnly,
    streamOnly: row.access === "STREAM",
    downloadLimit: row.downloadLimit,
    downloads: row.downloads,
    limitUsedAbove: above.limitUsed,
    burn: row.burn,
    busyLevel: busy?.level ?? 0,
  });
}
