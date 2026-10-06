import "server-only";
import type { DbClient } from "../db/client";

/** The singleton settings row; created with defaults on first use. */
export function getServerConfig(db: DbClient) {
  return db.serverConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: { signupMode: true, theme: true } });
}

/** Marks an unused invite as used; false when the code is unknown or already used. */
export async function consumeInvite(db: DbClient, code: string, accountName: string, at: Date): Promise<boolean> {
  const { count } = await db.invite.updateMany({ where: { code, usedAt: null }, data: { usedAt: at, usedByName: accountName } });
  return count === 1;
}

export async function updateServerConfig(db: DbClient, data: { signupMode?: "OPEN" | "INVITE" | "CLOSED"; theme?: string | null }): Promise<void> {
  await db.serverConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

/** Invite codes, newest first. */
export function listInvites(db: DbClient) {
  return db.invite.findMany({ orderBy: { createdAt: "desc" }, select: { code: true, createdAt: true, usedByName: true } });
}

export async function createInvite(db: DbClient, code: string): Promise<void> {
  await db.invite.create({ data: { code } });
}

/** Revokes an unused code; false when it is unknown or already used. */
export async function revokeInvite(db: DbClient, code: string): Promise<boolean> {
  const { count } = await db.invite.deleteMany({ where: { code, usedAt: null } });
  return count === 1;
}
