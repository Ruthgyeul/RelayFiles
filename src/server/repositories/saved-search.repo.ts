import "server-only";
import type { DbClient } from "../db/client";

const SELECT = { id: true, query: true } as const;

/** An account's saved searches, oldest first. */
export function listSavedSearches(db: DbClient, accountId: string) {
  return db.savedSearch.findMany({ where: { accountId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: SELECT });
}

export function countSavedSearches(db: DbClient, accountId: string) {
  return db.savedSearch.count({ where: { accountId } });
}

export function findSavedSearch(db: DbClient, accountId: string, query: string) {
  return db.savedSearch.findUnique({ where: { accountId_query: { accountId, query } }, select: SELECT });
}

export function createSavedSearch(db: DbClient, data: { id: string; accountId: string; query: string }) {
  return db.savedSearch.create({ data, select: SELECT });
}

/** Deletes one of the account's saved searches; 0 when it is not the account's (or gone). */
export async function deleteSavedSearch(db: DbClient, accountId: string, id: string): Promise<number> {
  const { count } = await db.savedSearch.deleteMany({ where: { accountId, id } });
  return count;
}
