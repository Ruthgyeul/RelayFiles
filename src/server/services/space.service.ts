import "server-only";
import { getEnv } from "@/config/env";
import { formatSize } from "@/domain/format";
import { BYTES_PER_GB } from "@/domain/quota";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import type { AccountRow } from "../repositories/account.repo";
import { accountUsage, anonUsage } from "../repositories/node.repo";
import { accountTrashedBytes, anonTrashedBytes } from "../repositories/trash.repo";
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
  /** Unfinished uploads whose reservation already covers part of the bytes checked (left out of the reserved total). */
  covering?: ReadonlySet<string>;
}

const scopesOf = (accountId: string, volumeId: string): ReservationScope[] => [{ kind: "account", id: accountId }, { kind: "volume", id: volumeId }, { kind: "anon" }];
const scopeKey = (scope: ReservationScope) => (scope.kind === "anon" ? scope.kind : `${scope.kind}:${scope.id}`);

/** Bytes an account holds on disk: its files plus deleted files still in the trash. */
async function heldBytes(accountId: string): Promise<bigint> {
  const [{ usedBytes }, trashed] = await Promise.all([accountUsage(db(), accountId), accountTrashedBytes(db(), accountId)]);
  return usedBytes + trashed;
}

/**
 * What new bytes must fit in, before unfinished uploads are counted: the account quota, the
 * volume's free space above its reserve, and (for anonymous accounts) ANON_TOTAL_QUOTA_GB.
 * Deleted files count until the daily job empties the trash: they still take disk space, and
 * "upload, delete, repeat" would otherwise fill the volume past every quota.
 */
async function budgetsOf(owner: SpaceOwner, volume: SpaceVolume, { quotas = true }: SpaceOptions): Promise<Budget[]> {
  const budgets: Budget[] = [];
  if (quotas && owner.quotaBytes !== null) {
    const quota = owner.quotaBytes;
    const usedBytes = await heldBytes(owner.id);
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
    const [files, trashed] = await Promise.all([anonUsage(db()), anonTrashedBytes(db())]);
    budgets.push({ scope: { kind: "anon" }, limit: total - files - trashed, full: () => new ApiError("INSUFFICIENT_STORAGE") });
  }
  return budgets;
}

/** Refuses `bytes` that would not fit, counting uploads that started but have not finished. */
export async function assertSpace(owner: SpaceOwner, bytes: number, volume: SpaceVolume, options: SpaceOptions = {}): Promise<void> {
  for (const budget of await budgetsOf(owner, volume, options)) {
    const reserved = await reservedBytes(budget.scope, Date.now(), options.covering);
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
  try {
    await recheckReservation(owner, bytes, volume);
  } catch (error) {
    await releaseSpace(uploadId, owner.id, volume.id);
    throw error;
  }
}

/**
 * The usage read before reserving can be stale: a copy or upload that finished in between
 * moved its bytes from "reserved" to "used" and neither number saw them. Reading the
 * reservations (this one included) before the usage closes that gap: bytes leave the
 * reservations only after they count as used.
 */
async function recheckReservation(owner: SpaceOwner, bytes: number, volume: SpaceVolume): Promise<void> {
  const reserved = new Map(await Promise.all(scopesOf(owner.id, volume.id).map(async (scope) => [scopeKey(scope), await reservedBytes(scope)] as const)));
  for (const budget of await budgetsOf(owner, volume, {})) {
    const held = reserved.get(scopeKey(budget.scope)) ?? 0n;
    if (budget.limit !== null && held > budget.limit) throw budget.full(held - BigInt(bytes));
  }
}

/** Drops an upload's reservation (finished: its bytes now count as used; or cancelled). */
export async function releaseSpace(uploadId: string, accountId: string, volumeId: string): Promise<void> {
  await releaseUpload(uploadId, scopesOf(accountId, volumeId));
}
