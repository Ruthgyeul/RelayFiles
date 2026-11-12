import "server-only";
import type { DbClient } from "../db/client";
import { ACCOUNT_SELECT } from "./account.repo";

const TOKEN_SELECT = { id: true, name: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true } as const;

export interface NewApiToken {
  id: string;
  accountId: string;
  name: string;
  secretHash: string;
  scopes: string[];
  expiresAt: Date | null;
}

export function createApiTokenRow(db: DbClient, data: NewApiToken) {
  return db.apiToken.create({ data, select: TOKEN_SELECT });
}

export function listApiTokenRows(db: DbClient, accountId: string) {
  return db.apiToken.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, select: TOKEN_SELECT });
}

/** Serializes token creation for one account until the transaction ends (count, then create). */
export async function lockApiTokensOf(tx: DbClient, accountId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`api-tokens:${accountId}`}))`;
}

export function countApiTokens(db: DbClient, accountId: string): Promise<number> {
  return db.apiToken.count({ where: { accountId } });
}

/** Deletes one of the account's tokens; false when it has no such token. */
/** Deletes one token of the account; returns its name, or null when there was none. */
export async function deleteApiToken(db: DbClient, accountId: string, id: string): Promise<string | null> {
  const row = await db.apiToken.findFirst({ where: { id, accountId }, select: { name: true } });
  if (!row) return null;
  // Gone already (revoked at the same time elsewhere): reported like a token that never was.
  return (await db.apiToken.deleteMany({ where: { id, accountId } })).count === 1 ? row.name : null;
}

/** Deletes every token of the account (its account token was replaced); returns how many. */
export async function deleteApiTokensOf(db: DbClient, accountId: string): Promise<number> {
  return (await db.apiToken.deleteMany({ where: { accountId } })).count;
}

/** A token by its id, with its hash and its account. */
export function findApiTokenWithAccount(db: DbClient, id: string) {
  return db.apiToken.findUnique({ where: { id }, select: { ...TOKEN_SELECT, secretHash: true, account: { select: ACCOUNT_SELECT } } });
}

/** Records use, at most once per `since` (a busy token would otherwise write on every request). */
export async function touchApiToken(db: DbClient, id: string, at: Date, since: Date): Promise<void> {
  await db.apiToken.updateMany({ where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: since } }] }, data: { lastUsedAt: at } });
}

/** Daily cleanup: tokens past their expiry date. */
export async function deleteExpiredApiTokens(db: DbClient, now: Date): Promise<number> {
  return (await db.apiToken.deleteMany({ where: { expiresAt: { lte: now } } })).count;
}
