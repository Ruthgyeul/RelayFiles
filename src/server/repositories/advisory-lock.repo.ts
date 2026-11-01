import "server-only";
import type { DbClient } from "../db/client";

/*
 * Write locks of an account's files (docs/architecture.md "쓰기 잠금"): PostgreSQL advisory locks
 * held until the transaction ends. Every storage transaction that changes files takes the locks
 * of its volume and its account SHARED, so writes run side by side. A volume move takes the
 * account's lock EXCLUSIVE and a layout migration or `storage:fsck --fix` the volume's: that waits
 * for the writes already running, and the flag it sets meanwhile refuses every later one.
 */
const accountKey = (accountId: string) => `storage-write:account:${accountId}`;
const volumeKey = (volumeId: string) => `storage-write:volume:${volumeId}`;

/** Takes the shared write locks of a volume and an account (a storage transaction that changes files). */
export async function lockWritesShared(tx: DbClient, accountId: string, volumeId: string): Promise<void> {
  // Always the volume first: the same order in every transaction.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${volumeKey(volumeId)}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${accountKey(accountId)}))`;
}

/** Waits at most `waitSec` for a lock in this transaction (PostgreSQL lock_timeout, transaction-local). */
async function limitLockWait(tx: DbClient, waitSec: number): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${waitSec}s`}, true)`;
}

/** Takes an account's write lock exclusively: waits for its running writes (at most `waitSec`). */
export async function lockAccountWritesExclusive(tx: DbClient, accountId: string, waitSec: number): Promise<void> {
  await limitLockWait(tx, waitSec);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountKey(accountId)}))`;
}

/** Takes a volume's write lock exclusively: waits for every running write on it (at most `waitSec`). */
export async function lockVolumeWritesExclusive(tx: DbClient, volumeId: string, waitSec: number): Promise<void> {
  await limitLockWait(tx, waitSec);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${volumeKey(volumeId)}))`;
}

/** What decides whether an account's files may change now (read after taking the shared locks). */
export async function writeStateOf(tx: DbClient, accountId: string) {
  const row = await tx.account.findUnique({ where: { id: accountId }, select: { migrating: true, volumeId: true, volume: { select: { status: true } } } });
  return row ? { migrating: row.migrating, volumeId: row.volumeId, volumeStatus: row.volume.status } : null;
}

/**
 * Serializes runs of a maintenance command (`npm run data:migrate`) across processes and hosts: a
 * second run waits here until the first one's transaction ends. Returns false without waiting
 * when another run holds it, so the caller can say so before waiting with {@link waitForRunLock}.
 */
export async function tryRunLock(tx: DbClient, name: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`run:${name}`})) AS locked`;
  return row?.locked === true;
}

export async function waitForRunLock(tx: DbClient, name: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`run:${name}`}))`;
}
