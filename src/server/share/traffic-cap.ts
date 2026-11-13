import "server-only";
import { getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import { capReached, gbToBytes, secondsUntilUtcMidnight, utcDay } from "@/domain/traffic";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { redis } from "../redis";
import { trafficOfAccountOn } from "../repositories/traffic.repo";

/** A link's counter outlives its day by this much, so a late write never starts a counter that never expires. */
const COUNTER_GRACE_SEC = MS.hour / MS.second;

const linkKey = (rootId: string, now: number) => `traffic:link:${rootId}:${utcDay(now)}`;

/** The account limit, SHARE_DAILY_BYTES_CAP_GB, in bytes (null: none). */
function accountCap(): bigint | null {
  const gb = getEnv("policy").SHARE_DAILY_BYTES_CAP_GB;
  return gb === undefined ? null : gbToBytes(gb);
}

/**
 * Refuses a visitor's new download, playback or zip with 429 once the link (the shared item's own
 * daily limit) or the owner's account (SHARE_DAILY_BYTES_CAP_GB) has sent its bytes for the UTC
 * day; Retry-After is the time left until midnight UTC. Checked before sending, so the response
 * that crosses a limit still finishes.
 */
export async function assertShareTraffic(owner: { id: string }, root: { id: string; dailyBytesCap: bigint | null }, now: number): Promise<void> {
  const account = accountCap();
  if (root.dailyBytesCap === null && account === null) return;
  const [linkUsed, accountUsed] = await Promise.all([
    root.dailyBytesCap === null
      ? Promise.resolve(0n)
      : redis()
          .get(linkKey(root.id, now))
          .then((value) => BigInt(value ?? "0")),
    account === null ? Promise.resolve(0n) : trafficOfAccountOn(db(), owner.id, new Date(now)),
  ]);
  const reached = capReached({ used: linkUsed, cap: root.dailyBytesCap }, { used: accountUsed, cap: account });
  if (reached === null) return;
  const message =
    reached === "link" ? "This link has used up today's traffic. Try again after midnight UTC." : "This server's daily sharing limit for this account is used up. Try again after midnight UTC.";
  throw new ApiError("RATE_LIMITED", message, { retryAfter: secondsUntilUtcMidnight(now) });
}

/** Adds bytes a visitor was sent through a link to the link's counter for the day (fire and forget). */
export function countLinkTraffic(rootId: string, bytes: bigint, now: number = Date.now()): void {
  if (bytes <= 0n) return;
  const key = linkKey(rootId, now);
  redis()
    .multi()
    .incrby(key, bytes.toString())
    .expire(key, secondsUntilUtcMidnight(now) + COUNTER_GRACE_SEC)
    .exec()
    .catch((error: unknown) => logger.warn("link traffic not counted", { error }));
}
