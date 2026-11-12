import "server-only";
import type { DbClient } from "../db/client";

/** Adds served bytes to the account's traffic for the day (UTC). */
export async function addTraffic(db: DbClient, accountId: string, bytes: bigint, at: Date): Promise<void> {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  await db.trafficDaily.upsert({
    where: { accountId_day: { accountId, day } },
    create: { accountId, day, bytes },
    update: { bytes: { increment: bytes } },
  });
}

/** Stored daily totals of an account since `from` (days without traffic have no row). */
export function trafficSince(db: DbClient, accountId: string, from: Date) {
  return db.trafficDaily.findMany({ where: { accountId, day: { gte: from } }, select: { day: true, bytes: true } });
}

/** Bytes served to everyone on one UTC day (no account split), for /metrics. */
export async function trafficTotalOn(db: DbClient, day: Date): Promise<bigint> {
  const total = await db.trafficDaily.aggregate({ where: { day }, _sum: { bytes: true } });
  return total._sum.bytes ?? 0n;
}

/** Bytes an account's share links sent on one UTC day. */
export async function trafficOfAccountOn(db: DbClient, accountId: string, at: Date): Promise<bigint> {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const row = await db.trafficDaily.findUnique({ where: { accountId_day: { accountId, day } }, select: { bytes: true } });
  return row?.bytes ?? 0n;
}
