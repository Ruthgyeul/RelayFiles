import { AUTH, MS } from "@/config/policy";

/**
 * Device session lifetimes: every session ends a fixed time after sign-in (shorter for
 * admins), and admin actions that expose or change accounts need a recent token entry.
 */

export interface SessionTimes {
  createdAt: number;
  /** Last re-authentication (epoch ms), if any. */
  reauthAt: number | null;
}

/** When a session signed in at `createdAt` stops being valid (epoch ms). */
export function sessionEndsAt(createdAt: number, isAdmin: boolean): number {
  return createdAt + (isAdmin ? AUTH.adminSessionDays : AUTH.memberSessionDays) * MS.day;
}

export function isSessionOver(session: SessionTimes, isAdmin: boolean, now: number): boolean {
  return now >= sessionEndsAt(session.createdAt, isAdmin);
}

/** True when the token was entered on this session (sign-in or re-authentication) within the window. */
export function hasRecentAuth(session: SessionTimes, now: number): boolean {
  const last = Math.max(session.createdAt, session.reauthAt ?? 0);
  return now - last < AUTH.reauthWindowMin * MS.minute;
}
