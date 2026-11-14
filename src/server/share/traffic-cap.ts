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

const linkKey = (nodeId: string, now: number) => `traffic:link:${nodeId}:${utcDay(now)}`;

/** An item with its own daily limit (null: none). */
export interface CappedItem {
  id: string;
  dailyBytesCap: bigint | null;
}

/**
 * The items whose own daily limit covers a response: every limited item from the account root
 * down to what is sent. A folder's limit then also holds for the links of files inside it.
 */
export const cappedOn = (chain: readonly CappedItem[]): CappedItem[] => chain.filter((row) => row.dailyBytesCap !== null);

/** The account limit, SHARE_DAILY_BYTES_CAP_GB, in bytes (null: none). */
function accountCap(): bigint | null {
  const gb = getEnv("policy").SHARE_DAILY_BYTES_CAP_GB;
  return gb === undefined ? null : gbToBytes(gb);
}

/**
 * Refuses a visitor's new download, playback or zip with 429 once a limited item on the way
 * (`capped`, see {@link cappedOn}) or the owner's account (SHARE_DAILY_BYTES_CAP_GB) has sent its
 * bytes for the UTC day; Retry-After is the time left until midnight UTC. Checked before sending,
 * so the response that crosses a limit still finishes.
 */
export async function assertShareTraffic(owner: { id: string }, capped: readonly CappedItem[], now: number): Promise<void> {
  const account = accountCap();
  if (capped.length === 0 && account === null) return;
  const [itemsUsed, accountUsed] = await Promise.all([
    capped.length === 0
      ? Promise.resolve([] as bigint[])
      : redis()
          .mget(...capped.map((item) => linkKey(item.id, now)))
          .then((values) => values.map((value) => BigInt(value ?? "0"))),
    account === null ? Promise.resolve(0n) : trafficOfAccountOn(db(), owner.id, new Date(now)),
  ]);
  const reached = capReached(
    capped.map((item, index) => ({ used: itemsUsed[index] ?? 0n, cap: item.dailyBytesCap })),
    { used: accountUsed, cap: account },
  );
  if (reached === null) return;
  const message =
    reached === "link" ? "This link has used up today's traffic. Try again after midnight UTC." : "This server's daily sharing limit for this account is used up. Try again after midnight UTC.";
  throw new ApiError("RATE_LIMITED", message, { retryAfter: secondsUntilUtcMidnight(now) });
}

/** Adds bytes a visitor was sent to the day's counter of every limited item on the way (fire and forget). */
export function countLinkTraffic(capped: readonly CappedItem[], bytes: bigint, now: number = Date.now()): void {
  if (bytes <= 0n || capped.length === 0) return;
  const multi = redis().multi();
  for (const item of capped) {
    const key = linkKey(item.id, now);
    multi.incrby(key, bytes.toString()).expire(key, secondsUntilUtcMidnight(now) + COUNTER_GRACE_SEC);
  }
  multi.exec().catch((error: unknown) => logger.warn("link traffic not counted", { error }));
}
