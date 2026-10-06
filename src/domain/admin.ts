import { BYTES_PER_GB } from "./quota";

/**
 * Admin "Accounts" rules from the design: account status badges and filters, and the
 * Manage dialog (role, deletion date, storage limit) with its preview text.
 */

const DAY_MS = 86_400_000;

/** Accounts deleted within this many days are "Expiring soon" (design: 7). */
export const EXPIRING_SOON_DAYS = 7;

export type AccountStatus = "admin" | "active" | "soon" | "expired";
export type AdminFilter = "all" | "active" | "soon" | "expired";

export const ADMIN_FILTERS: readonly { key: AdminFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "soon", label: "Expiring soon" },
  { key: "expired", label: "Pending deletion" },
];

export interface AdminLifecycle {
  createdAt: number;
  /** Deletion date set by an admin (epoch ms), or null for the default. */
  expiresAt: number | null;
  isAdmin: boolean;
  neverExpire: boolean;
}

/** The calendar deletion date, ignoring exemptions (design `delAt`). */
export function scheduledDeletion(account: Pick<AdminLifecycle, "createdAt" | "expiresAt">, ttlDays: number): number {
  return account.expiresAt ?? account.createdAt + ttlDays * DAY_MS;
}

/** Status badge and whole days left (Infinity when exempt). */
export function accountStatus(account: AdminLifecycle, ttlDays: number, now: number): { status: AccountStatus; left: number } {
  if (account.isAdmin) return { status: "admin", left: Infinity };
  if (account.neverExpire) return { status: "active", left: Infinity };
  const left = Math.ceil((scheduledDeletion(account, ttlDays) - now) / DAY_MS);
  return { status: left <= 0 ? "expired" : left <= EXPIRING_SOON_DAYS ? "soon" : "active", left };
}

export function matchesFilter(status: AccountStatus, filter: AdminFilter): boolean {
  return filter === "all" || status === filter || (filter === "active" && status === "admin");
}

/** Deletion choices in the Manage dialog. */
export type DaysChoice = 0 | 7 | 30 | 90 | 365 | "default" | "never";
export const DAYS_CHOICES: readonly { value: DaysChoice; label: string }[] = [
  { value: 0, label: "No change" },
  { value: 7, label: "+7 days" },
  { value: 30, label: "+30 days" },
  { value: 90, label: "+90 days" },
  { value: 365, label: "+1 year" },
  { value: "default", label: "Default (14d from creation)" },
  { value: "never", label: "Never delete" },
];

export const QUOTA_CHOICES: readonly { value: number | null; label: string }[] = [
  { value: 1, label: "1 GB" },
  { value: 5, label: "5 GB" },
  { value: 10, label: "10 GB" },
  { value: 50, label: "50 GB" },
  { value: 100, label: "100 GB" },
  { value: null, label: "Unlimited" },
];

export interface ManageDraft {
  isAdmin: boolean;
  days: DaysChoice;
  /** "Restart 14 days from today". */
  reset: boolean;
}

/**
 * What saving the Manage dialog does to the deletion date (design `saveManage`):
 * extensions are added to the current date (or today if later), "Default" clears the admin
 * date, "Never delete" exempts the account.
 */
export function applyManage(account: AdminLifecycle, draft: ManageDraft, ttlDays: number, now: number): { expiresAt: number | null; neverExpire: boolean } {
  let expiresAt = account.expiresAt;
  if (draft.reset) expiresAt = now + ttlDays * DAY_MS;
  if (typeof draft.days === "number" && draft.days > 0) expiresAt = Math.max(draft.reset && expiresAt !== null ? expiresAt : scheduledDeletion(account, ttlDays), now) + draft.days * DAY_MS;
  if (draft.days === "default") expiresAt = null;
  return { expiresAt, neverExpire: draft.days === "never" };
}

/** The preview line at the bottom of the Manage dialog; `format` renders a date. */
export function managePreview(account: AdminLifecycle, draft: ManageDraft, ttlDays: number, now: number, format: (at: number) => string): string {
  if (draft.isAdmin || draft.days === "never") return "This account will never be deleted automatically.";
  const current = scheduledDeletion(account, ttlDays);
  const next = scheduledDeletion({ createdAt: account.createdAt, expiresAt: applyManage(account, draft, ttlDays, now).expiresAt }, ttlDays);
  return `Currently deletes ${format(current)}. ${next !== current ? `After saving: ${format(next)}.` : "No change."}`;
}

/** Note under the storage limit (design `mQuotaNote`); bytes are decimal GB like the design. */
export function quotaNote(usedBytes: number, quotaGb: number | null, formatSize: (bytes: number) => string): string {
  const over = quotaGb !== null && usedBytes > quotaGb * BYTES_PER_GB;
  return `Using ${formatSize(usedBytes)}${over ? ". Over the new limit: existing files stay, new uploads are blocked." : "."}`;
}
