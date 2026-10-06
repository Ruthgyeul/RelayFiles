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
