import "server-only";
import type { DbClient } from "../db/client";

const CONFIG_ID = 1;

/**
 * Creates the singleton settings row with defaults if it is missing. `INSERT … ON CONFLICT DO
 * NOTHING` is atomic, unlike Prisma's upsert, so concurrent first requests cannot collide.
 */
async function ensureRow(db: DbClient): Promise<void> {
  await db.serverConfig.createMany({ data: [{ id: CONFIG_ID }], skipDuplicates: true });
}

/** The singleton settings row; created with defaults on first use. */
export async function getServerConfig(db: DbClient) {
  await ensureRow(db);
  return db.serverConfig.findUniqueOrThrow({ where: { id: CONFIG_ID }, select: { signupMode: true, theme: true } });
}

/**
 * Uses an invite once; false when the code is unknown, used up or expired. One conditional
 * UPDATE on the locked row, so sign-ups at the last use cannot both pass.
 */
export async function consumeInvite(db: DbClient, code: string, accountName: string, at: Date): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE "Invite" SET uses = uses + 1, "usedAt" = ${at}, "usedByName" = ${accountName}
    WHERE code = ${code} AND uses < "maxUses" AND ("expiresAt" IS NULL OR "expiresAt" > ${at})`;
  return count === 1;
}

export async function updateServerConfig(db: DbClient, data: { signupMode?: "OPEN" | "INVITE" | "CLOSED"; theme?: string | null }): Promise<void> {
  await ensureRow(db);
  await db.serverConfig.update({ where: { id: CONFIG_ID }, data });
}

/** Invite codes, newest first. */
export function listInvites(db: DbClient) {
  return db.invite.findMany({ orderBy: { createdAt: "desc" }, select: { code: true, createdAt: true, usedByName: true, uses: true, maxUses: true, expiresAt: true } });
}

export async function createInvite(db: DbClient, code: string, limits: { maxUses: number; expiresAt: Date | null }): Promise<void> {
  await db.invite.create({ data: { code, ...limits } });
}

/** Revokes a code that still creates accounts; false when it is unknown, used up or expired. */
export async function revokeInvite(db: DbClient, code: string, now: Date): Promise<boolean> {
  const count = await db.$executeRaw`DELETE FROM "Invite" WHERE code = ${code} AND uses < "maxUses" AND ("expiresAt" IS NULL OR "expiresAt" > ${now})`;
  return count === 1;
}

/** Daily cleanup: codes that were used up or expired before `before`. */
export async function deleteFinishedInvites(db: DbClient, before: Date): Promise<number> {
  return db.$executeRaw`DELETE FROM "Invite" WHERE ("expiresAt" IS NOT NULL AND "expiresAt" <= ${before}) OR (uses >= "maxUses" AND "usedAt" <= ${before})`;
}
