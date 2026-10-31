import "server-only";
import type { NextResponse } from "next/server";
import { AUTH } from "@/config/policy";
import { getEnv } from "@/config/env";
import type { SessionAccount, SessionState, SignupMode } from "@/contracts/auth";
import { deletionDate, isExpired } from "@/domain/account";
import { hasRecentAuth, isSessionOver } from "@/domain/session";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { storageBusyOf, type AccountRow } from "../repositories/account.repo";
import { accountUsage } from "../repositories/node.repo";
import { findLiveSessions, revokeSessions, touchSessions } from "../repositories/session.repo";
import { cookieSecrets } from "./keys";
import { decodeSessionCookie, encodeSessionCookie, MAX_SESSIONS_PER_DEVICE, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, type SessionCookie } from "./session-cookie";

export interface DeviceAccount {
  sessionId: string;
  account: AccountRow;
  /** When this session signed in and last re-authenticated (admin actions, `requireRecentAuth`). */
  signedInAt: Date;
  reauthAt: Date | null;
}

/** Accounts signed in on the requesting device, resolved against the database. */
export interface DeviceSession {
  accounts: DeviceAccount[];
  active: DeviceAccount | null;
  /** Cookie value that matches `accounts`; differs from the request when sessions were dropped. */
  cookie: SessionCookie;
  /** True when the cookie must be rewritten (revoked or expired sessions were removed). */
  stale: boolean;
  /** The request comes from ADMIN_ALLOWED_CIDRS (or no range is set); admin routes need it. */
  adminNetwork: boolean;
}

/**
 * Reads the device cookie and keeps only sessions that are still valid: not revoked
 * (signed out elsewhere or token regenerated), not past their own lifetime (AUTH.*SessionDays)
 * and whose account has not expired.
 */
export async function loadDeviceSession(rawCookie: string | undefined, adminNetwork: boolean, now: Date = new Date()): Promise<DeviceSession> {
  const cookie = decodeSessionCookie(rawCookie, cookieSecrets());
  const rows = await findLiveSessions(db(), cookie.sessionIds);
  const ttlDays = getEnv("policy").ACCOUNT_TTL_DAYS;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const accounts: DeviceAccount[] = [];
  for (const id of cookie.sessionIds) {
    const row = byId.get(id);
    if (!row || isExpired(row.account, ttlDays, now)) continue;
    if (isSessionOver({ createdAt: row.createdAt.getTime(), reauthAt: null }, row.account.isAdmin, now.getTime())) continue;
    accounts.push({ sessionId: id, account: row.account, signedInAt: row.createdAt, reauthAt: row.reauthAt });
  }
  const active = accounts.find((item) => item.sessionId === cookie.activeSessionId) ?? accounts.at(-1) ?? null;
  const next: SessionCookie = { sessionIds: accounts.map((item) => item.sessionId), activeSessionId: active?.sessionId ?? null };

  const touchBefore = now.getTime() - AUTH.touchIntervalSec * 1_000;
  await touchSessions(
    db(),
    rows.filter((row) => row.lastSeenAt.getTime() < touchBefore).map((row) => row.id),
    now,
  );

  return {
    accounts,
    active,
    cookie: next,
    stale: rawCookie !== undefined && (next.sessionIds.length !== cookie.sessionIds.length || next.activeSessionId !== cookie.activeSessionId),
    adminNetwork,
  };
}

/** The active account, or 401 when nobody is signed in on this device. */
export function requireActive(device: DeviceSession): DeviceAccount {
  if (!device.active) throw new ApiError("UNAUTHORIZED");
  return device.active;
}

/** The active account when it is an admin; members get 403 (the proxy may also limit by address). */
export function requireAdmin(device: DeviceSession): DeviceAccount {
  const active = requireActive(device);
  if (!active.account.isAdmin || !device.adminNetwork) throw new ApiError("FORBIDDEN");
  return active;
}

/**
 * For actions that expose or change accounts (showing or replacing a token, deleting an
 * account, and the admin's roles and sign-up mode): the session must have signed in or entered
 * the token within AUTH.reauthWindowMin. A device left signed in, or a script injected into the
 * page, cannot read the token, which never expires and signs in anywhere. This applies to
 * members too: a new account sees its token right after sign-up, inside the window.
 */
export function requireRecentAuth(entry: DeviceAccount, now: Date = new Date()): void {
  if (!hasRecentAuth({ createdAt: entry.signedInAt.getTime(), reauthAt: entry.reauthAt?.getTime() ?? null }, now.getTime())) throw new ApiError("REAUTH_REQUIRED");
}

export function toSessionAccount(account: AccountRow): SessionAccount {
  const deletesAt = deletionDate(account, getEnv("policy").ACCOUNT_TTL_DAYS);
  return {
    id: account.id,
    name: account.name,
    color: account.color,
    isAdmin: account.isAdmin,
    neverExpire: account.neverExpire,
    deletesAt: deletesAt?.toISOString() ?? null,
    quotaBytes: account.quotaBytes?.toString() ?? null,
  };
}

/** Session state for the client, including the active account's storage use. */
export async function toSessionState(device: { accounts: readonly Pick<DeviceAccount, "account">[]; active: Pick<DeviceAccount, "account"> | null }, signupMode: SignupMode): Promise<SessionState> {
  const id = device.active?.account.id;
  const [usage, storageBusy] = id ? await Promise.all([accountUsage(db(), id), storageBusyOf(db(), id)]) : [null, null];
  return {
    accounts: device.accounts.map((item) => toSessionAccount(item.account)),
    activeAccountId: device.active?.account.id ?? null,
    signupMode,
    usage: usage && { usedBytes: usage.usedBytes.toString(), rootItems: usage.rootItems, storageBusy: storageBusy === true },
  };
}

/** Writes (or clears) the signed device cookie on a response. */
export function writeSessionCookie(response: NextResponse, cookie: SessionCookie): void {
  if (cookie.sessionIds.length === 0) {
    response.cookies.delete(SESSION_COOKIE);
    return;
  }
  response.cookies.set(SESSION_COOKIE, encodeSessionCookie(cookie, cookieSecrets()[0]!), {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv("app").PUBLIC_URL.startsWith("https:"),
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

/** Cookie value after adding a new session and making it active. */
export function withSession(cookie: SessionCookie, sessionId: string): SessionCookie {
  return { sessionIds: [...cookie.sessionIds.filter((id) => id !== sessionId), sessionId], activeSessionId: sessionId };
}

/**
 * Adds a new session to the device cookie and revokes the oldest ones it pushes out (the cookie
 * holds MAX_SESSIONS_PER_DEVICE): a session the device no longer lists must not stay valid in
 * the database, where a copied old cookie could still use it.
 */
export async function addDeviceSession(cookie: SessionCookie, sessionId: string, now: Date = new Date()): Promise<SessionCookie> {
  const next = withSession(cookie, sessionId);
  const dropped = next.sessionIds.slice(0, Math.max(0, next.sessionIds.length - MAX_SESSIONS_PER_DEVICE));
  await revokeSessions(db(), dropped, now);
  return { ...next, sessionIds: next.sessionIds.slice(dropped.length) };
}

/** Cookie value after removing a session; the newest remaining one becomes active if needed. */
export function withoutSession(cookie: SessionCookie, sessionId: string): SessionCookie {
  const sessionIds = cookie.sessionIds.filter((id) => id !== sessionId);
  const activeSessionId = cookie.activeSessionId !== sessionId && cookie.activeSessionId ? cookie.activeSessionId : (sessionIds.at(-1) ?? null);
  return { sessionIds, activeSessionId };
}
