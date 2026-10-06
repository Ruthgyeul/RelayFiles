/**
 * Account lifecycle rules from the design prototype (`delAt`, profile retention text,
 * admin rows). Member accounts are deleted with their files a fixed number of days after
 * creation unless an admin extended them or exempted them; admins never expire.
 */

const DAY_MS = 86_400_000;

/** Palette for account placeholders (`newAcct` in the prototype). */
export const ACCOUNT_COLORS = ["var(--accent)", "#9b5de5", "#f15bb5", "#00a3d9", "#00a878", "#e08a00"] as const;

/** Deterministic color for an account id (base-36 value of its first four characters). */
export function accountColor(accountId: string): string {
  const value = parseInt(accountId.slice(0, 4), 36);
  return ACCOUNT_COLORS[(Number.isFinite(value) ? value : 0) % ACCOUNT_COLORS.length]!;
}

export interface Lifecycle {
  createdAt: Date;
  expiresAt: Date | null;
  isAdmin: boolean;
  neverExpire: boolean;
}

/** Date the account is deleted, or null when it never expires. */
export function deletionDate(account: Lifecycle, ttlDays: number): Date | null {
  if (account.isAdmin || account.neverExpire) return null;
  return account.expiresAt ?? new Date(account.createdAt.getTime() + ttlDays * DAY_MS);
}

/** Whole days left until deletion (rounded up, never negative); null when it never expires. */
export function daysLeft(account: Lifecycle, ttlDays: number, now: Date): number | null {
  const at = deletionDate(account, ttlDays);
  if (!at) return null;
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / DAY_MS));
}

/** True once the deletion date has passed (the account must no longer be usable). */
export function isExpired(account: Lifecycle, ttlDays: number, now: Date): boolean {
  const at = deletionDate(account, ttlDays);
  return at !== null && at.getTime() <= now.getTime();
}
