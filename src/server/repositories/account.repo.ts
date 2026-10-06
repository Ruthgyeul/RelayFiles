import "server-only";
import type { DbClient } from "../db/client";

/** Account fields the app works with; token columns are only read where needed. */
export const ACCOUNT_SELECT = {
  id: true,
  name: true,
  color: true,
  isAdmin: true,
  neverExpire: true,
  expiresAt: true,
  quotaBytes: true,
  createdAt: true,
  volumeId: true,
  stripMetadataOnShare: true,
} as const;

export interface AccountRow {
  id: string;
  name: string;
  color: string;
  isAdmin: boolean;
  neverExpire: boolean;
  expiresAt: Date | null;
  quotaBytes: bigint | null;
  createdAt: Date;
  volumeId: string;
  /** Images sent through public links lose location and camera data (default on). */
  stripMetadataOnShare: boolean;
}

export interface NewAccount {
  id: string;
  name: string;
  tokenLookup: string;
  tokenEnc: Uint8Array<ArrayBuffer>;
  color: string;
  isAdmin: boolean;
  neverExpire: boolean;
  quotaBytes: bigint | null;
  volumeId: string;
}

export function createAccount(db: DbClient, data: NewAccount): Promise<AccountRow> {
  return db.account.create({ data, select: ACCOUNT_SELECT });
}

/** Finds the account for any of the token lookup hashes (current and previous key). */
export function findAccountByLookups(db: DbClient, lookups: string[]) {
  return db.account.findFirst({ where: { tokenLookup: { in: lookups } }, select: { ...ACCOUNT_SELECT, tokenLookup: true, tokenEnc: true } });
}

export function findAccountToken(db: DbClient, accountId: string) {
  return db.account.findUnique({ where: { id: accountId }, select: { tokenEnc: true } });
}

export async function updateAccountToken(db: DbClient, accountId: string, token: { tokenLookup: string; tokenEnc: Uint8Array<ArrayBuffer> }): Promise<void> {
  await db.account.update({ where: { id: accountId }, data: token });
}

export async function touchAccountLogin(db: DbClient, accountId: string, at: Date): Promise<void> {
  await db.account.update({ where: { id: accountId }, data: { lastLoginAt: at } });
}

export function findAccountById(db: DbClient, accountId: string) {
  return db.account.findUnique({ where: { id: accountId }, select: ACCOUNT_SELECT });
}

export async function updatePreferences(db: DbClient, accountId: string, data: { stripMetadataOnShare: boolean }): Promise<void> {
  await db.account.update({ where: { id: accountId }, data });
}

/** Deletes the account row; sessions, items, events and traffic go with it (cascade). */
export async function deleteAccountRow(db: DbClient, accountId: string): Promise<void> {
  await db.account.delete({ where: { id: accountId } });
}

/** Last sign-in time (the profile shows it; the session account row omits it). */
export async function lastLoginOf(db: DbClient, accountId: string): Promise<Date | null> {
  const row = await db.account.findUnique({ where: { id: accountId }, select: { lastLoginAt: true } });
  return row?.lastLoginAt ?? null;
}
