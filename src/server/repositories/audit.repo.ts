import "server-only";
import type { DbClient } from "../db/client";

export interface NewAuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetId: string | null;
  detail: string | null;
  ipMasked: string;
  at: Date;
}

export async function recordAuditEvent(db: DbClient, event: NewAuditEvent): Promise<void> {
  await db.auditEvent.create({ data: event });
}

/** The newest entries first. */
export function listAuditEvents(db: DbClient, limit: number) {
  return db.auditEvent.findMany({ orderBy: { at: "desc" }, take: limit });
}

/** Drops entries older than `before`. */
export async function purgeAuditEvents(db: DbClient, before: Date): Promise<number> {
  const { count } = await db.auditEvent.deleteMany({ where: { at: { lt: before } } });
  return count;
}
