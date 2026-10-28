import "server-only";
import type { DbClient } from "../db/client";
import { ACCOUNT_SELECT } from "./account.repo";

const TOKEN_SELECT = { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true } as const;

export interface NewApiToken {
  id: string;
  accountId: string;
  name: string;
  lookup: string;
  scopes: string[];
  expiresAt: Date | null;
}

export function createApiTokenRow(db: DbClient, data: NewApiToken) {
  return db.apiToken.create({ data, select: TOKEN_SELECT });
}

export function listApiTokenRows(db: DbClient, accountId: string) {
  return db.apiToken.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, select: TOKEN_SELECT });
}

export function countApiTokens(db: DbClient, accountId: string): Promise<number> {
  return db.apiToken.count({ where: { accountId } });
}

/** Deletes one of the account's tokens; false when it has no such token. */
export async function deleteApiToken(db: DbClient, accountId: string, id: string): Promise<boolean> {
  return (await db.apiToken.deleteMany({ where: { id, accountId } })).count === 1;
}

/** The token with one of these lookup HMACs (current key, then the previous one) and its account. */
export function findApiTokenByLookups(db: DbClient, lookups: readonly string[]) {
  return db.apiToken.findFirst({ where: { lookup: { in: [...lookups] } }, select: { ...TOKEN_SELECT, lookup: true, account: { select: ACCOUNT_SELECT } } });
}

/** Re-keys a token found with the previous TOKEN_HMAC_KEY (key rotation). */
export async function setApiTokenLookup(db: DbClient, id: string, lookup: string): Promise<void> {
  await db.apiToken.update({ where: { id }, data: { lookup } });
}

/** Records use, at most once per `since` (a busy token would otherwise write on every request). */
export async function touchApiToken(db: DbClient, id: string, at: Date, since: Date): Promise<void> {
  await db.apiToken.updateMany({ where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: since } }] }, data: { lastUsedAt: at } });
}

/** Daily cleanup: tokens past their expiry date. */
export async function deleteExpiredApiTokens(db: DbClient, now: Date): Promise<number> {
  return (await db.apiToken.deleteMany({ where: { expiresAt: { lte: now } } })).count;
}
