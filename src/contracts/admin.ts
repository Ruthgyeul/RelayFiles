import { z } from "zod";
import { MAX_QUOTA_GB } from "@/domain/quota";

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

/** Admin actions written to the audit log. */
export const AUDIT_ACTIONS = [
  "account.manage",
  "account.delete",
  "signup.mode",
  "cleanup.run",
  "invite.create",
  "invite.revoke",
  "token.reveal",
  "token.regenerate",
  "announcement.publish",
  "announcement.remove",
  "theme.set",
  "incident.post",
  "incident.edit",
  "incident.delete",
  "apiToken.create",
  "apiToken.revoke",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
