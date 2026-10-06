import "server-only";
import type { DbClient } from "../db/client";
import { ACCOUNT_SELECT } from "./account.repo";

export interface NewSession {
  id: string;
  accountId: string;
  os: string;
  browser: string;
  country: string | null;
  city: string | null;
  ipMasked: string;
}

export async function createSession(db: DbClient, data: NewSession): Promise<void> {
  await db.session.create({ data });
}

/** Sessions that are not revoked, with their accounts, for the ids in a device cookie. */
export function findLiveSessions(db: DbClient, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db.session.findMany({
    where: { id: { in: ids }, revokedAt: null },
    select: { id: true, lastSeenAt: true, account: { select: ACCOUNT_SELECT } },
  });
}

export async function revokeSession(db: DbClient, sessionId: string, at: Date): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: at } });
}

export async function touchSessions(db: DbClient, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.session.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: at } });
}

/** Live sessions of an account, most recently used first. */
export function listAccountSessions(db: DbClient, accountId: string) {
  return db.session.findMany({
    where: { accountId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, os: true, browser: true, country: true, city: true, ipMasked: true, lastSeenAt: true },
  });
}

/** Revokes one session of an account; false when it is not one of its live sessions. */
export async function revokeAccountSession(db: DbClient, accountId: string, sessionId: string, at: Date): Promise<boolean> {
  const { count } = await db.session.updateMany({ where: { id: sessionId, accountId, revokedAt: null }, data: { revokedAt: at } });
  return count > 0;
}

/** Revokes every live session of an account except `keepId`. Returns how many were revoked. */
export async function revokeOtherSessions(db: DbClient, accountId: string, keepId: string, at: Date): Promise<number> {
  const { count } = await db.session.updateMany({ where: { accountId, revokedAt: null, id: { not: keepId } }, data: { revokedAt: at } });
  return count;
}
