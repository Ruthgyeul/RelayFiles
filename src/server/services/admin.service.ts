import "server-only";
import { getEnv } from "@/config/env";
import { AUTH, FILE_REQUEST, MS, SHARE } from "@/config/policy";
import type { AdminAccounts, CleanupResult, ManageInput } from "@/contracts/admin";
import { isExpired } from "@/domain/account";
import { applyManage } from "@/domain/admin";
import { BYTES_PER_GB } from "@/domain/quota";
import { db, type DbClient } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { findAccountById, type AccountRow } from "../repositories/account.repo";
import { deleteExpiredApiTokens } from "../repositories/api-token.repo";
import { deleteExpiredFileRequests } from "../repositories/file-request.repo";
import { countAdmins, fileTotalsByAccount, listAccountsForAdmin, lockAdminRoles, updateAccountByAdmin } from "../repositories/admin.repo";
import { purgeRetiredLinks, retireLinks } from "../repositories/link-tombstone.repo";
import { expiredItemIds, findRootFolder } from "../repositories/node.repo";
import { purgeDeadSessions } from "../repositories/session.repo";
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
  await db().$transaction(async (tx) => {
    await lockAdminRoles(tx);
    const target = await findAccountById(tx, targetId);
    if (!target) throw new ApiError("NOT_FOUND");
    if (target.isAdmin && !input.isAdmin && (await countAdmins(tx)) <= 1) throw new ApiError("BAD_REQUEST", "Keep at least one admin");
    await saveManage(tx, target, input, now);
  });
}

async function saveManage(tx: DbClient, target: AccountRow, input: ManageInput, now: Date): Promise<void> {
  const next = applyManage(
    { createdAt: target.createdAt.getTime(), expiresAt: target.expiresAt?.getTime() ?? null, isAdmin: target.isAdmin, neverExpire: target.neverExpire },
    { isAdmin: input.isAdmin, days: input.days, reset: input.reset },
    getEnv("policy").ACCOUNT_TTL_DAYS,
    now.getTime(),
  );
  await updateAccountByAdmin(tx, target.id, {
    isAdmin: input.isAdmin,
    neverExpire: next.neverExpire,
    expiresAt: next.expiresAt === null ? null : new Date(next.expiresAt),
    quotaBytes: input.quotaGb === null ? null : BigInt(Math.round(input.quotaGb * BYTES_PER_GB)),
  });
}

/** Deletes a member account and its files (admins must be demoted first). */
export async function deleteAccountAsAdmin(targetId: string): Promise<{ name: string }> {
  const target = await findAccountById(db(), targetId);
  if (!target) throw new ApiError("NOT_FOUND");
  if (target.isAdmin) throw new ApiError("FORBIDDEN", "Admin accounts can't be deleted. Make it a member first.");
  await deleteAccount(target);
  return { name: target.name };
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
      const root = await findRootFolder(db(), account.id);
      if (root) await retireLinks(db(), [root.id], now);
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
      await retireLinks(db(), ids, now);
      // Their links ended: they are not kept under "Recently deleted".
      result.items += (await deleteItems(owner, ids, { recoverable: false })).deleted;
    } catch (error) {
      logger.error("cleanup: items not deleted", { accountId, error });
    }
  }
  await purgeRetiredLinks(db(), new Date(now.getTime() - SHARE.tombstoneDays * MS.day));
  // Signed out or past the longest session lifetime: those rows only grow the table.
  await purgeDeadSessions(db(), new Date(now.getTime() - Math.max(AUTH.adminSessionDays, AUTH.memberSessionDays) * MS.day));
  // Expired API tokens are refused already; the rows only clutter the profile list.
  await deleteExpiredApiTokens(db(), now);
  // Expired upload links answer "expired" for a while, then go (their files stay).
  await deleteExpiredFileRequests(db(), new Date(now.getTime() - FILE_REQUEST.expiredKeptDays * MS.day));
  return result;
}
