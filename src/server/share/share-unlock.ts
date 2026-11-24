import "server-only";
import { verify } from "@node-rs/argon2";
import type { ClientInfo } from "../auth/client-info";
import { cookieSecrets } from "../auth/keys";
import { ApiError } from "../http/api-error";
import { type ChainRow } from "../repositories/share.repo";
import { addUnlock, isUnlocked, unlocksWith } from "./unlock-cookie";
import { countUnlockGuess, refundUnlockGuess } from "./unlock-limit";
import { loadLink, type ShareViewer } from "./share-link";

/** An item (or collection) on the way to a link that may have a password. */
type LockRow = Pick<ChainRow, "id" | "linkId" | "passwordHash">;

/**
 * Checks a password for a link. The link may need several (its own and those of folders
 * above it): the one entered unlocks every item on the way it belongs to, and the page asks
 * again while others are missing. Wrong guesses are limited per link and address; a correct
 * one returns the new unlock cookie value (the password itself is never stored client-side).
 */
export async function unlockShare(linkId: string, password: string, viewer: ShareViewer, client: ClientInfo, now: number): Promise<string> {
  const link = await loadLink(linkId, viewer, now);
  if (!link || link.status === "private") throw new ApiError("NOT_FOUND");
  const secrets = cookieSecrets();
  // A collection has one password, its own (items behind others are not in it).
  const guards: LockRow[] =
    link.kind === "node" ? link.chain : [{ id: link.collection.id, linkId: link.collection.linkId, passwordHash: link.collection.passwordHash }];
  const locked = guards.filter((row) => row.passwordHash !== null && !isUnlocked(viewer.unlocks, row.linkId, row.passwordHash, secrets));
  if (locked.length === 0) return addUnlock(viewer.unlocks, linkId, link.kind === "node" ? link.root.passwordHash : link.collection.passwordHash, secrets[0]!, now);

  // Guesses count against each password still needed (the item holding it, not the link
  // used), so links to different items under the same locked folder share one budget.
  const counted = new Map<string, string[]>();
  for (const row of locked) counted.set(row.id, await countUnlockGuess(row.id, client));
  const matching: LockRow[] = [];
  for (const row of locked) if (await verify(row.passwordHash!, password)) matching.push(row);
  if (matching.length === 0) throw new ApiError("FORBIDDEN", "Wrong password");
  // A right password gives back only this attempt, on the items it opened: knowing one
  // password does not reset the guesses made at another (as with sign-in, refundTokenAttempt).
  await Promise.all(matching.map((row) => refundUnlockGuess(counted.get(row.id) ?? [])));
  return unlocksWith(
    viewer.unlocks,
    matching.map((row) => ({ linkId: row.linkId, passwordHash: row.passwordHash })),
    secrets[0]!,
    now,
  );
}
