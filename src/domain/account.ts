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

/** Whole days from `now` until `at` (rounded up, never negative). */
export function daysLeftUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}

/** Whole days left until deletion (rounded up, never negative); null when it never expires. */
export function daysLeft(account: Lifecycle, ttlDays: number, now: Date): number | null {
  const at = deletionDate(account, ttlDays);
  if (!at) return null;
  return daysLeftUntil(at.getTime(), now.getTime());
}

/** True once the deletion date has passed (the account must no longer be usable). */
export function isExpired(account: Lifecycle, ttlDays: number, now: Date): boolean {
  const at = deletionDate(account, ttlDays);
  return at !== null && at.getTime() <= now.getTime();
}

/** Masked token for the profile (design: first 4, 28 dots, last 4). */
const TOKEN_MASK = { shown: 4, dots: 28 } as const;

export function maskToken(token: string): string {
  return `${token.slice(0, TOKEN_MASK.shown)}${"•".repeat(TOKEN_MASK.dots)}${token.slice(-TOKEN_MASK.shown)}`;
}

/** The retention notice under the profile card (design `retention`); `deletesOn` is already formatted. */
export function retentionText(account: { isAdmin: boolean; neverExpire: boolean; extended: boolean }, deletesOn: string): string {
  if (account.isAdmin) return "Admin account. It is never deleted automatically. The token below is the only way back in.";
  if (account.neverExpire) return "An admin has exempted this account from automatic deletion. The token below is the only way back in.";
  return `Anonymous account with its own private root folder. It is deleted together with all of its files on ${deletesOn}${
    account.extended ? " (extended by the admin)" : ", 14 days after it was created"
  }, whether or not you sign in. Only the admin can extend it. The token below is the only way back in.`;
}

/**
 * Bytes per day for the `days` days ending today (UTC days, oldest first), from stored rows
 * that may skip days without traffic.
 */
export function dailySeries(rows: readonly { day: Date; bytes: bigint }[], days: number, today: Date): bigint[] {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const byDay = new Map(rows.map((row) => [row.day.getTime(), row.bytes]));
  return Array.from({ length: days }, (_, index) => byDay.get(end - (days - 1 - index) * DAY_MS) ?? 0n);
}

/** Where a device signed in from: "Seoul, KR", "KR", or "Local network" without Cloudflare data. */
export function deviceLocation(country: string | null, city: string | null): string {
  if (!country) return "Local network";
  return city ? `${city}, ${country}` : country;
}
