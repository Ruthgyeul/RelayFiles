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

export interface AuditFilter {
  limit: number;
  /** Id of the last entry of the previous page. */
  cursor?: string;
  actions?: readonly string[];
  /** Entries by this account or about it. */
  accountId?: string;
}

/** The newest entries first (ties by id, so pages never skip or repeat an entry). */
export function listAuditEvents(db: DbClient, { limit, cursor, actions, accountId }: AuditFilter) {
  return db.auditEvent.findMany({
    where: {
      ...(actions ? { action: { in: [...actions] } } : {}),
      ...(accountId ? { OR: [{ actorId: accountId }, { targetId: accountId }] } : {}),
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

export function auditEventExists(db: DbClient, id: string): Promise<boolean> {
  return db.auditEvent.count({ where: { id } }).then((count) => count > 0);
}

/** Drops entries older than `before`. */
export async function purgeAuditEvents(db: DbClient, before: Date): Promise<number> {
  const { count } = await db.auditEvent.deleteMany({ where: { at: { lt: before } } });
  return count;
}
