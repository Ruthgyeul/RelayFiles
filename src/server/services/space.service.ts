import "server-only";
import { getEnv } from "@/config/env";
import { formatSize } from "@/domain/format";
import { BYTES_PER_GB } from "@/domain/quota";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import type { AccountRow } from "../repositories/account.repo";
import { accountUsage, anonUsage } from "../repositories/node.repo";
import type { StorageDriver } from "../storage/driver";
import { availableAboveReserve } from "../storage/registry";
import { releaseUpload, reservedBytes, reserveUpload, type ReservationScope, type ScopeLimit } from "../upload/reservations";

export type SpaceOwner = Pick<AccountRow, "id" | "volumeId" | "quotaBytes" | "isAdmin">;

/** The volume an upload writes to. */
export interface SpaceVolume {
  id: string;
  reservePct: number;
  driver: StorageDriver;
}

interface Budget extends ScopeLimit {
  /** The error when `reserved` (unfinished uploads) plus the new bytes do not fit. */
  full: (reserved: bigint) => ApiError;
}

/** Skip the account quota and the anonymous total (an admin import with --ignore-quota). */
export interface SpaceOptions {
  quotas?: boolean;
}

const scopesOf = (accountId: string, volumeId: string): ReservationScope[] => [{ kind: "account", id: accountId }, { kind: "volume", id: volumeId }, { kind: "anon" }];

/**
 * What new bytes must fit in, before unfinished uploads are counted: the account quota, the
 * volume's free space above its reserve, and (for anonymous accounts) ANON_TOTAL_QUOTA_GB.
 */
async function budgetsOf(owner: SpaceOwner, volume: SpaceVolume, { quotas = true }: SpaceOptions): Promise<Budget[]> {
  const budgets: Budget[] = [];
  if (quotas && owner.quotaBytes !== null) {
    const quota = owner.quotaBytes;
    const { usedBytes } = await accountUsage(db(), owner.id);
    budgets.push({
      scope: { kind: "account", id: owner.id },
      limit: quota - usedBytes,
      full: (reserved) => {
        const left = quota - usedBytes - reserved;
        return new ApiError("INSUFFICIENT_STORAGE", `Not enough space: ${formatSize(Number(left > 0n ? left : 0n))} left of ${formatSize(Number(quota))}`);
      },
    });
  }
  const space = await volume.driver.space();
  budgets.push({ scope: { kind: "volume", id: volume.id }, limit: availableAboveReserve(space.total, space.available, volume.reservePct), full: () => new ApiError("INSUFFICIENT_STORAGE") });
  const anonTotalGb = getEnv("policy").ANON_TOTAL_QUOTA_GB;
  if (quotas && !owner.isAdmin && anonTotalGb !== undefined) {
    const total = BigInt(Math.round(anonTotalGb * BYTES_PER_GB));
    budgets.push({ scope: { kind: "anon" }, limit: total - (await anonUsage(db())), full: () => new ApiError("INSUFFICIENT_STORAGE") });
  }
  return budgets;
}

/** Refuses `bytes` that would not fit, counting uploads that started but have not finished. */
export async function assertSpace(owner: SpaceOwner, bytes: number, volume: SpaceVolume, options: SpaceOptions = {}): Promise<void> {
  for (const budget of await budgetsOf(owner, volume, options)) {
    const reserved = await reservedBytes(budget.scope);
    if (budget.limit !== null && reserved + BigInt(bytes) > budget.limit) throw budget.full(reserved);
  }
}

/**
 * Checks and reserves the space of an upload that is starting, in one step, so uploads
 * started at the same time cannot all pass the check. Released by {@link releaseSpace}.
 */
export async function reserveSpace(owner: SpaceOwner, uploadId: string, bytes: number, volume: SpaceVolume): Promise<void> {
  const budgets = await budgetsOf(owner, volume, {});
  const full = await reserveUpload(uploadId, bytes, budgets);
  if (full) {
    const budget = budgets.find((entry) => entry.scope === full.scope)!;
    throw budget.full(await reservedBytes(budget.scope));
  }
}

/** Drops an upload's reservation (finished: its bytes now count as used; or cancelled). */
export async function releaseSpace(uploadId: string, accountId: string, volumeId: string): Promise<void> {
  await releaseUpload(uploadId, scopesOf(accountId, volumeId));
}
