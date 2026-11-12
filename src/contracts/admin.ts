import { z } from "zod";
import { AUTH } from "@/config/policy";
import { AUDIT_GROUP_KEYS, type AuditAction } from "@/domain/audit";
import { isAccountId } from "@/domain/ids";
import { MAX_QUOTA_GB } from "@/domain/quota";
import type { UsageRowValues } from "@/domain/usage-report";

/** One row of the admin Accounts page. File contents are never listed here. */
export interface AdminAccount {
  id: string;
  name: string;
  isAdmin: boolean;
  neverExpire: boolean;
  createdAt: string;
  lastLoginAt: string;
  /** Deletion date set by an admin, or null for the default (creation + TTL). */
  expiresAt: string | null;
  quotaBytes: string | null;
  usedBytes: string;
  files: number;
  /** Signed in on the requesting device. */
  here: boolean;
  /** The requesting device's active account. */
  you: boolean;
}

export interface AdminAccounts {
  accounts: AdminAccount[];
  ttlDays: number;
}

export const manageSchema = z.object({
  isAdmin: z.boolean(),
  days: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal("default"), z.literal("never")]),
  reset: z.boolean(),
  /** GB (decimal); null = unlimited. */
  quotaGb: z.number().positive().max(MAX_QUOTA_GB).nullable(),
});
export type ManageInput = z.infer<typeof manageSchema>;

export interface CleanupResult {
  accounts: number;
  items: number;
}

export { AUDIT_ACTIONS, type AuditAction } from "@/domain/audit";

/** One audit log entry (GET /api/admin/audit). */
export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  targetId: string | null;
  detail: string | null;
  ipMasked: string;
  at: string;
}

/** GET /api/admin/audit query: newest first, `cursor` = the last entry id of the previous page. */
export const auditQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(AUTH.auditListLimit).default(AUTH.auditPageSize),
  group: z.enum(AUDIT_GROUP_KEYS).optional(),
  /** Entries by this account or about it. */
  account: z.string().refine(isAccountId).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** One page of the audit log; `nextCursor` is null on the last page. */
export interface AuditPage {
  events: AuditEntry[];
  nextCursor: string | null;
}

/** GET /api/admin/usage(/csv) query: UTC days, both inclusive; omitted = the last ADMIN_REPORT.defaultDays. */
export const usageQuerySchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
export type UsageQuery = z.infer<typeof usageQuerySchema>;

/** One account of the usage report. No file names, links or addresses. */
export type UsageRow = UsageRowValues;

/** The admin usage report: per-account storage and share traffic of a range, and traffic per month. */
export interface UsageReport {
  from: string;
  to: string;
  days: number;
  rows: UsageRow[];
  /** Share traffic of every account per month the range touches, oldest first. */
  months: { month: string; bytes: string }[];
}
