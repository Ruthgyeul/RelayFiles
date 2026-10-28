import "server-only";
import { randomUUID } from "node:crypto";
import { AUTH, MS } from "@/config/policy";
import { AUDIT_ACTIONS, type AuditAction, type AuditEntry } from "@/contracts/admin";
import type { ClientInfo } from "../auth/client-info";
import type { DeviceAccount } from "../auth/device-session";
import { db } from "../db/client";
import { logger } from "../logger";
import { listAuditEvents, purgeAuditEvents, recordAuditEvent } from "../repositories/audit.repo";

const isAuditAction = (value: string): value is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(value);

/**
 * Records an admin action after it succeeded. A failed write is logged, not thrown: the action
 * already happened and must not be reported to the admin as failed.
 */
export async function audit(actor: Pick<DeviceAccount, "account">, client: Pick<ClientInfo, "ipMasked">, action: AuditAction, target: { id?: string; detail?: string } = {}): Promise<void> {
  try {
    await recordAuditEvent(db(), {
      id: randomUUID(),
      actorId: actor.account.id,
      actorName: actor.account.name,
      action,
      targetId: target.id ?? null,
      detail: target.detail ?? null,
      ipMasked: client.ipMasked,
      at: new Date(),
    });
  } catch (error) {
    logger.error("audit event not recorded", { action, error });
  }
}

/** The newest audit entries for the admin API. */
export async function recentAuditEvents(): Promise<AuditEntry[]> {
  const rows = await listAuditEvents(db(), AUTH.auditListLimit);
  return rows.flatMap((row) => (isAuditAction(row.action) ? [{ ...row, action: row.action, at: row.at.toISOString() }] : []));
}

/** Daily cleanup: entries older than AUTH.auditRetentionDays. */
export function purgeOldAuditEvents(now: Date): Promise<number> {
  return purgeAuditEvents(db(), new Date(now.getTime() - AUTH.auditRetentionDays * MS.day));
}
