import "server-only";
import { randomUUID } from "node:crypto";
import { MS, SECURITY_LOG } from "@/config/policy";
import type { SecurityLogEntry, SecurityLogPage, SecurityLogQuery } from "@/contracts/profile";
import { isSecurityEvent, type SecurityEvent } from "@/domain/security-log";
import type { ClientInfo } from "../auth/client-info";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { redis } from "../redis";
import { accountEventExists, listAccountEvents, purgeAccountEvents, recordAccountEvent } from "../repositories/account-event.repo";

/** Where the request came from, as the log keeps it (never the real address). */
export type EventOrigin = Pick<ClientInfo, "os" | "browser" | "ipMasked" | "country">;

/**
 * Adds an entry to the account's security log. Never throws: the action it describes already
 * happened (or was already refused) and must be reported as such; a failed write is logged.
 */
export async function logAccountEvent(accountId: string, origin: EventOrigin, kind: SecurityEvent, detail?: string): Promise<void> {
  try {
    await recordAccountEvent(db(), {
      id: randomUUID(),
      accountId,
      kind,
      detail: detail ?? null,
      os: origin.os,
      browser: origin.browser,
      ipMasked: origin.ipMasked,
      country: origin.country,
      at: new Date(),
    });
  } catch (error) {
    logger.error("security event not recorded", { kind, error });
  }
}

/**
 * "API token refused": logged once per token per SECURITY_LOG.rejectedTokenRepeatSec, so a
 * script retrying a revoked token cannot fill the log. Never throws.
 */
export async function logRejectedApiToken(accountId: string, tokenId: string, origin: EventOrigin, reason: string): Promise<void> {
  try {
    const first = await redis().set(`seclog:rejected:${tokenId}`, "1", "EX", SECURITY_LOG.rejectedTokenRepeatSec, "NX");
    if (first !== "OK") return;
  } catch (error) {
    logger.warn("rejected token not throttled", { error });
    return;
  }
  await logAccountEvent(accountId, origin, "apiToken.rejected", reason);
}

/**
 * One page of the account's log, newest first. A cursor that is not one of its entries
 * (another account's, or purged meanwhile) is a 400, not page one.
 */
export async function securityLogPage(accountId: string, query: SecurityLogQuery): Promise<SecurityLogPage> {
  if (query.cursor && !(await accountEventExists(db(), accountId, query.cursor))) throw new ApiError("BAD_REQUEST");
  const rows = await listAccountEvents(db(), accountId, { limit: query.limit, cursor: query.cursor });
  const events: SecurityLogEntry[] = rows.flatMap(({ accountId: _account, ...row }) => (isSecurityEvent(row.kind) ? [{ ...row, kind: row.kind, at: row.at.toISOString() }] : []));
  const last = rows.at(-1);
  return { events, nextCursor: rows.length === query.limit && last ? last.id : null };
}

/** Daily cleanup: entries older than SECURITY_LOG.retentionDays. */
export function purgeOldAccountEvents(now: Date): Promise<number> {
  return purgeAccountEvents(db(), new Date(now.getTime() - SECURITY_LOG.retentionDays * MS.day));
}
