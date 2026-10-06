import "server-only";
import { getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import type { DeviceDto, Preferences, ProfileData } from "@/contracts/profile";
import { dailySeries, deletionDate, deviceLocation, maskToken } from "@/domain/account";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { deleteAccountRow, lastLoginOf, updatePreferences, type AccountRow } from "../repositories/account.repo";
import { accountUsage, contentCounts, expiredItemIds } from "../repositories/node.repo";
import { listAccountSessions, revokeAccountSession, revokeOtherSessions } from "../repositories/session.repo";
import { trafficSince } from "../repositories/traffic.repo";
import { withStorageTransaction } from "../storage/storage-transaction";
import { revealToken } from "./auth.service";
import { deleteItems } from "./node-ops.service";
import { driverForAccount } from "./volume.service";

/** Days shown in the profile "Traffic" card. */
const TRAFFIC_DAYS = 30;

export async function listDevices(accountId: string, currentSessionId: string): Promise<DeviceDto[]> {
  const sessions = await listAccountSessions(db(), accountId);
  const devices = sessions.map((session) => ({
    id: session.id,
    os: session.os,
    browser: session.browser,
    location: deviceLocation(session.country, session.city),
    ipMasked: session.ipMasked,
    lastSeenAt: session.lastSeenAt.toISOString(),
    current: session.id === currentSessionId,
  }));
  // This device first, then most recently used (design order).
  return devices.sort((a, b) => Number(b.current) - Number(a.current));
}

/** Everything the My Profile page shows. */
export async function profileOf(account: AccountRow, currentSessionId: string, now: Date = new Date()): Promise<ProfileData> {
  const ttlDays = getEnv("policy").ACCOUNT_TTL_DAYS;
  const from = new Date(now.getTime() - (TRAFFIC_DAYS - 1) * MS.day);
  const [token, usage, counts, traffic, devices, lastLoginAt] = await Promise.all([
    revealToken(account.id),
    accountUsage(db(), account.id),
    contentCounts(db(), account.id),
    trafficSince(db(), account.id, new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))),
    listDevices(account.id, currentSessionId),
    lastLoginOf(db(), account.id),
  ]);
  const days = dailySeries(traffic, TRAFFIC_DAYS, now);
  return {
    account: {
      id: account.id,
      name: account.name,
      isAdmin: account.isAdmin,
      neverExpire: account.neverExpire,
      extended: account.expiresAt !== null,
      createdAt: account.createdAt.toISOString(),
      lastLoginAt: (lastLoginAt ?? now).toISOString(),
      deletesAt: deletionDate(account, ttlDays)?.toISOString() ?? null,
      quotaBytes: account.quotaBytes?.toString() ?? null,
      stripMetadataOnShare: account.stripMetadataOnShare,
    },
    maskedToken: maskToken(token),
    usage: { usedBytes: usage.usedBytes.toString(), ...counts },
    traffic: { total: days.reduce((sum, bytes) => sum + bytes, 0n).toString(), days: days.map(String) },
    devices,
  };
}

export async function signOutDevice(accountId: string, sessionId: string): Promise<void> {
  if (!(await revokeAccountSession(db(), accountId, sessionId, new Date()))) throw new ApiError("NOT_FOUND");
}

export async function signOutOtherDevices(accountId: string, currentSessionId: string): Promise<{ signedOut: number }> {
  return { signedOut: await revokeOtherSessions(db(), accountId, currentSessionId, new Date()) };
}

export async function savePreferences(accountId: string, preferences: Preferences): Promise<Preferences> {
  await updatePreferences(db(), accountId, preferences);
  return preferences;
}

/** "Purge now": deletes this account's expired items right away (the cleanup job does it daily). */
export async function purgeExpired(owner: AccountRow, now: Date): Promise<{ deleted: number }> {
  const ids = (await expiredItemIds(db(), owner.id, now)).map((row) => row.id);
  if (ids.length === 0) return { deleted: 0 };
  return deleteItems(owner, ids);
}

/**
 * Deletes the account with its token, sessions and every file. The account folder goes to
 * the volume's trash (purged later), so a failed database delete can be undone.
 */
export async function deleteAccount(owner: AccountRow): Promise<void> {
  const driver = await driverForAccount(owner);
  await withStorageTransaction(db(), async (tx, undo) => {
    await deleteAccountRow(tx, owner.id);
    const location = { accountId: owner.id, segments: [] };
    const trashed = await driver.moveToTrash(location);
    undo.push("restore account folder", () => driver.restoreFromTrash(trashed, location));
  });
  await driver.removeAccountAssets(owner.id).catch((error: unknown) => logger.warn("account assets not removed", { error }));
}
