import "server-only";
import { randomUUID } from "node:crypto";
import { AUTH, MS } from "@/config/policy";
import type { AuditEntry, AuditPage, AuditQuery } from "@/contracts/admin";
import { auditGroupActions, isAuditAction, type AuditAction } from "@/domain/audit";
import type { ClientInfo } from "../auth/client-info";
import type { DeviceAccount } from "../auth/device-session";
import { db } from "../db/client";
import { logger } from "../logger";
import { ApiError } from "../http/api-error";
import { auditEventExists, listAuditEvents, purgeAuditEvents, recordAuditEvent } from "../repositories/audit.repo";

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

/**
 * One page of the audit log, newest first, optionally only one filter group and entries by or
 * about one account. A cursor that no longer exists (purged meanwhile) is a 400, not page one.
 */
export async function auditEventPage(query: AuditQuery): Promise<AuditPage> {
  if (query.cursor && !(await auditEventExists(db(), query.cursor))) throw new ApiError("BAD_REQUEST");
  const rows = await listAuditEvents(db(), {
    limit: query.limit,
    cursor: query.cursor,
    actions: query.group ? auditGroupActions(query.group) : undefined,
    accountId: query.account,
  });
  const events: AuditEntry[] = rows.flatMap((row) => (isAuditAction(row.action) ? [{ ...row, action: row.action, at: row.at.toISOString() }] : []));
  const last = rows.at(-1);
  return { events, nextCursor: rows.length === query.limit && last ? last.id : null };
}

/** Daily cleanup: entries older than AUTH.auditRetentionDays. */
export function purgeOldAuditEvents(now: Date): Promise<number> {
  return purgeAuditEvents(db(), new Date(now.getTime() - AUTH.auditRetentionDays * MS.day));
}
