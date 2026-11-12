import "server-only";
import type { DbClient } from "../db/client";

export interface NewAccountEvent {
  id: string;
  accountId: string;
  kind: string;
  detail: string | null;
  os: string;
  browser: string;
  ipMasked: string;
  country: string | null;
  at: Date;
}

export async function recordAccountEvent(db: DbClient, event: NewAccountEvent): Promise<void> {
  await db.accountEvent.create({ data: event });
}

/** One account's entries, newest first (ties by id, so pages never skip or repeat an entry). */
export function listAccountEvents(db: DbClient, accountId: string, { limit, cursor }: { limit: number; cursor?: string }) {
  return db.accountEvent.findMany({ where: { accountId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: limit, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
}

/** Whether `id` is an entry of this account (a cursor from another account is not). */
export function accountEventExists(db: DbClient, accountId: string, id: string): Promise<boolean> {
  return db.accountEvent.count({ where: { id, accountId } }).then((count) => count > 0);
}

/** Drops entries older than `before`, of every account. */
export async function purgeAccountEvents(db: DbClient, before: Date): Promise<number> {
  const { count } = await db.accountEvent.deleteMany({ where: { at: { lt: before } } });
  return count;
}
