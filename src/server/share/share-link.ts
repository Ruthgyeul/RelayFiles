import "server-only";
import { getAppEnv, getEnv } from "@/config/env";
import { deletionDate } from "@/domain/account";
import { shareStatus, strictestGuard, type Busy, type ShareStatus } from "@/domain/share";
import { downloadBlock, type DownloadBlock } from "@/domain/share-access";
import { effectiveVisibility } from "@/domain/tree";
import { cookieSecrets } from "../auth/keys";
import { db } from "../db/client";
import { findAccountById } from "../repositories/account.repo";
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

/**
 * A link's settings, owner and status. Null when no item has this link. The status follows
 * the strictest settings from the account root down to the shared item (`strictestGuard`):
 * a folder above it that expired, was downloaded once as delete-after-download or has a
 * password closes or locks this link too, and so does the owner's account reaching its
 * deletion date.
 */
export async function loadLink(linkId: string, viewer: ShareViewer, now: number) {
  const root = await findByLinkId(db(), linkId);
  if (!root) return null;
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
    deletionDate(owner, getEnv("policy").ACCOUNT_TTL_DAYS)?.getTime() ?? null,
  );
  const status: ShareStatus = guard.burnUsed
    ? "expired"
    : shareStatus(
        {
          expAt: guard.expAt,
          burn: root.burn,
          downloads: root.downloads,
          downloadLimit: root.downloadLimit,
          effectiveVisibility: visibility,
          hasPassword: guard.hasPassword,
          unlocked: guard.unlocked,
        },
        now,
      );
  const isOwner = viewer.accountIds.includes(root.accountId);
  // To anyone but its owner a private link is "private" whatever else is true of it, and every
  // caller answers that as a link that does not exist: an "expired" or "limit reached" card (or
  // a 410/403, or an argon2 check on unlock) would tell someone guessing ids they found a real one.
  // The owner keeps the design's order and sees why the link is closed.
  return { root, chain, owner, status: !isOwner && visibility !== "public" ? "private" : status, isOwner };
}

export type LoadedLink = NonNullable<Awaited<ReturnType<typeof loadLink>>>;

/** An item below the link that visitors of the link may not reach: private, protected by its own password, or expired. */
const closedBelowLink = (row: ChainRow, now: number) => row.visibility === "PRIVATE" || row.passwordHash !== null || (row.expAt !== null && row.expAt.getTime() <= now);

/** The chain from the account root down to an item (the link's own chain is already loaded). */
export const chainTo = (link: LoadedLink, nodeId: string): Promise<ChainRow[]> => (nodeId === link.root.id ? Promise.resolve(link.chain) : sharedChain(db(), nodeId));

/**
 * The rows from the link's item down to the last row of `chain`, or null when that row is not
 * inside the link or something between them is closed to visitors (as in publicTree).
 */
export function trailInLink(chain: readonly ChainRow[], rootId: string, now: number): ChainRow[] | null {
  const rootAt = chain.findIndex((at) => at.id === rootId);
  if (rootAt < 0 || chain.slice(rootAt + 1).some((at) => closedBelowLink(at, now))) return null;
  return chain.slice(rootAt);
}

/**
 * Stream only and paused downloads set on the items above a row, from the account root down
 * to its parent. Like passwords and expiry (`strictestGuard`), a folder's setting applies to
 * everything inside it, whichever link the item is opened through.
 */
export interface WayAbove {
  streamOnly: boolean;
  dlPaused: boolean;
}

type WayRow = Pick<SharedRow, "access" | "dlPaused">;
const NOTHING_ABOVE: WayAbove = { streamOnly: false, dlPaused: false };
export const through = (way: WayAbove, row: WayRow): WayAbove => ({ streamOnly: way.streamOnly || row.access === "STREAM", dlPaused: way.dlPaused || row.dlPaused });

/** The way above the last row of a chain (account root first). */
export const wayAboveEnd = (chain: readonly WayRow[]) => chain.slice(0, -1).reduce(through, NOTHING_ABOVE);

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
    burn: row.burn,
    busyLevel: busy?.level ?? 0,
  });
}
