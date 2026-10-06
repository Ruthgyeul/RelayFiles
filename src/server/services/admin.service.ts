import "server-only";
import { getEnv } from "@/config/env";
import type { AdminAccounts, CleanupResult, ManageInput } from "@/contracts/admin";
import { isExpired } from "@/domain/account";
import { applyManage } from "@/domain/admin";
import { BYTES_PER_GB } from "@/domain/quota";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { findAccountById } from "../repositories/account.repo";
import { countAdmins, fileTotalsByAccount, listAccountsForAdmin, updateAccountByAdmin } from "../repositories/admin.repo";
import { expiredItemIds } from "../repositories/node.repo";
import { deleteItems } from "./node-ops.service";
import { deleteAccount } from "./profile.service";

/** The Accounts page: every account with usage; `here` = signed in on the requesting device. */
export async function listAccounts(deviceAccountIds: readonly string[], activeAccountId: string): Promise<AdminAccounts> {
  const [accounts, totals] = await Promise.all([listAccountsForAdmin(db()), fileTotalsByAccount(db())]);
  return {
    ttlDays: getEnv("policy").ACCOUNT_TTL_DAYS,
    accounts: accounts.map((account) => {
      const total = totals.get(account.id);
      return {
        id: account.id,
        name: account.name,
        isAdmin: account.isAdmin,
        neverExpire: account.neverExpire,
        createdAt: account.createdAt.toISOString(),
        lastLoginAt: account.lastLoginAt.toISOString(),
        expiresAt: account.expiresAt?.toISOString() ?? null,
        quotaBytes: account.quotaBytes?.toString() ?? null,
        usedBytes: (total?.bytes ?? 0n).toString(),
        files: total?.files ?? 0,
        here: deviceAccountIds.includes(account.id),
        you: account.id === activeAccountId,
      };
    }),
  };
}

/** Saves the Manage dialog: role, deletion date and storage limit. There is always one admin. */
export async function manageAccount(targetId: string, input: ManageInput, now: Date): Promise<void> {
  const target = await findAccountById(db(), targetId);
  if (!target) throw new ApiError("NOT_FOUND");
  if (target.isAdmin && !input.isAdmin && (await countAdmins(db())) <= 1) throw new ApiError("BAD_REQUEST", "Keep at least one admin");
  const next = applyManage(
    { createdAt: target.createdAt.getTime(), expiresAt: target.expiresAt?.getTime() ?? null, isAdmin: target.isAdmin, neverExpire: target.neverExpire },
    { isAdmin: input.isAdmin, days: input.days, reset: input.reset },
    getEnv("policy").ACCOUNT_TTL_DAYS,
    now.getTime(),
  );
  await updateAccountByAdmin(db(), target.id, {
    isAdmin: input.isAdmin,
    neverExpire: next.neverExpire,
    expiresAt: next.expiresAt === null ? null : new Date(next.expiresAt),
    quotaBytes: input.quotaGb === null ? null : BigInt(Math.round(input.quotaGb * BYTES_PER_GB)),
  });
}

/** Deletes a member account and its files (admins must be demoted first). */
export async function deleteAccountAsAdmin(targetId: string): Promise<void> {
  const target = await findAccountById(db(), targetId);
  if (!target) throw new ApiError("NOT_FOUND");
  if (target.isAdmin) throw new ApiError("FORBIDDEN", "Admin accounts can't be deleted. Make it a member first.");
  await deleteAccount(target);
}

/**
 * The cleanup job (daily, and "Run cleanup now"): deletes accounts past their deletion date
 * with all their files, then items past their own expiry and used delete-after-download items.
 */
export async function runCleanup(now: Date): Promise<CleanupResult> {
  const ttlDays = getEnv("policy").ACCOUNT_TTL_DAYS;
  const result: CleanupResult = { accounts: 0, items: 0 };
  for (const account of await listAccountsForAdmin(db())) {
    if (!isExpired(account, ttlDays, now)) continue;
    const full = await findAccountById(db(), account.id);
    if (!full) continue;
    try {
      await deleteAccount(full);
      result.accounts++;
    } catch (error) {
      logger.error("cleanup: account not deleted", { accountId: account.id, error });
    }
  }
  const byAccount = new Map<string, string[]>();
  for (const row of await expiredItemIds(db(), null, now)) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row.id]);
  for (const [accountId, ids] of byAccount) {
    const owner = await findAccountById(db(), accountId);
    if (!owner) continue;
    try {
      result.items += (await deleteItems(owner, ids)).deleted;
    } catch (error) {
      logger.error("cleanup: items not deleted", { accountId, error });
    }
  }
  return result;
}
