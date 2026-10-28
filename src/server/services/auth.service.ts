import "server-only";
import { BYTES_PER_GB } from "@/domain/quota";
import { getEnv } from "@/config/env";
import type { SignupMode } from "@/contracts/auth";
import { accountColor, isExpired } from "@/domain/account";
import { ID_LENGTH, newAccountId, newAccountToken, newAnonName, newLinkId, newNodeId, newSessionId } from "@/domain/ids";
import { failureMessage } from "@/domain/lockout";
import type { ClientInfo } from "../auth/client-info";
import { tokenKeys } from "../auth/keys";
import { allowSignup, beginTokenAttempt, lockoutPolicy, refundTokenAttempt, type TokenAttempt } from "../auth/login-limiter";
import { decryptToken, encryptToken, needsReencryption, tokenLookups } from "../auth/token-crypto";
import { db } from "../db/client";
import { retryOnUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { createAccount, findAccountByLookups, findAccountToken, touchAccountLogin, updateAccountToken, type AccountRow } from "../repositories/account.repo";
import { createRootFolder } from "../repositories/node.repo";
import { consumeInvite, getServerConfig } from "../repositories/server-config.repo";
import { createSession, markReauthenticated, revokeOtherSessions, revokeSession } from "../repositories/session.repo";
import { withStorageTransaction } from "../storage/storage-transaction";
import { volumeForNewAccount } from "./volume.service";

export interface SignedIn {
  account: AccountRow;
  sessionId: string;
}

export interface ProvisionedAccount {
  account: AccountRow;
  token: string;
  /** Null when no device session was requested (e.g. `npm run admin:create`). */
  sessionId: string | null;
}

export async function signupMode(): Promise<SignupMode> {
  const config = await getServerConfig(db());
  return config.signupMode.toLowerCase() as SignupMode;
}

/** Bytes as a fresh ArrayBuffer-backed array (the shape Prisma expects for Bytes columns). */
function bytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

interface ProvisionOptions {
  isAdmin: boolean;
  inviteCode?: string;
  client?: ClientInfo;
}

/**
 * Creates the account row, its root folder, its directory on the storage volume and
 * (optionally) a device session in one storage transaction: if any step fails, nothing is
 * left behind in the database or on disk (docs/security.md "계정 생성의 원자성").
 */
async function provisionAccount({ isAdmin, inviteCode, client }: ProvisionOptions): Promise<ProvisionedAccount> {
  const driver = await volumeForNewAccount();
  const keys = tokenKeys();
  const quotaGb = getEnv("policy").DEFAULT_QUOTA_GB;

  // Random ids collide practically never; a collision is retried with fresh ones.
  return retryOnUniqueViolation(() => {
    const id = newAccountId();
    const name = newAnonName();
    const token = newAccountToken();
    const now = new Date();
    return withStorageTransaction(db(), async (tx, undo) => {
      if (inviteCode && !(await consumeInvite(tx, inviteCode, name, now))) throw new ApiError("INVALID_INVITE");
      const account = await createAccount(tx, {
        id,
        name,
        tokenLookup: tokenLookups(token, keys)[0]!,
        tokenEnc: bytes(encryptToken(token, keys)),
        color: accountColor(id),
        isAdmin,
        neverExpire: isAdmin,
        quotaBytes: isAdmin ? null : BigInt(Math.round(quotaGb * BYTES_PER_GB)),
        volumeId: driver.volumeId,
      });
      await createRootFolder(tx, { id: newNodeId(), accountId: id, linkId: newLinkId() });
      const sessionId = client ? newSessionId() : null;
      if (client && sessionId) await createSession(tx, { id: sessionId, accountId: id, ...sessionFields(client) });
      await driver.ensureUserRoot(id);
      undo.push("remove new account root", async () => {
        await driver.moveToTrash({ accountId: id, segments: [] });
      });
      return { account, token, sessionId };
    });
  });
}

function sessionFields(client: ClientInfo) {
  return { os: client.os, browser: client.browser, country: client.country, city: client.city, ipMasked: client.ipMasked };
}

/** Anonymous sign-up from the sign-in dialog or the first visit, honoring the server's sign-up mode. */
export async function createAnonymousAccount(input: { inviteCode?: string }, client: ClientInfo): Promise<ProvisionedAccount & SignedIn> {
  const mode = await signupMode();
  if (mode === "closed") throw new ApiError("SIGNUP_CLOSED");
  if (mode === "invite" && !input.inviteCode) throw new ApiError("INVALID_INVITE");
  if (!(await allowSignup(client.ipKey))) throw new ApiError("RATE_LIMITED", "Too many new accounts from this network. Try again later.");
  const created = await provisionAccount({ isAdmin: false, inviteCode: mode === "invite" ? input.inviteCode : undefined, client });
  if (!created.sessionId) throw new ApiError("INTERNAL");
  return { ...created, sessionId: created.sessionId };
}

/** Creates an admin account from the server console (`npm run admin:create`). */
export function createAdminAccount(): Promise<ProvisionedAccount> {
  return provisionAccount({ isAdmin: true });
}

/**
 * Counts a token entry from this address before the token is looked at, and refuses it while
 * the address is locked out (login-limiter `beginTokenAttempt`).
 */
async function startTokenEntry(client: ClientInfo): Promise<Extract<TokenAttempt, { failures: number }>> {
  const attempt = await beginTokenAttempt(client.ipKey);
  if ("locked" in attempt) throw new ApiError("RATE_LIMITED", `Too many failed attempts. Try again in ${attempt.locked} s.`, { retryAfter: attempt.locked });
  return attempt;
}

/** The error for a wrong token: the lockout this attempt started, or how many attempts are left. */
function failedTokenEntry(token: string, attempt: Extract<TokenAttempt, { failures: number }>): ApiError {
  if (attempt.lockSeconds > 0) return new ApiError("RATE_LIMITED", "Too many failed attempts.", { retryAfter: attempt.lockSeconds });
  return new ApiError("INVALID_TOKEN", failureMessage(token, attempt.failures, lockoutPolicy(), ID_LENGTH.token));
}

/**
 * Signs in with a pasted token. Failures are counted per client address and lock sign-in
 * on the design's ladder (5 attempts → 30 s, 120 s, 600 s). A correct token gives back only its
 * own attempt: signing in to one's own account never resets the failures of guesses made from
 * the same address.
 */
export async function signInWithToken(token: string, client: ClientInfo, signedInAccountIds: readonly string[]): Promise<SignedIn> {
  const attempt = await startTokenEntry(client);
  const keys = tokenKeys();
  const found = token.length === ID_LENGTH.token ? await findAccountByLookups(db(), tokenLookups(token, keys)) : null;
  const ttlDays = getEnv("policy").ACCOUNT_TTL_DAYS;
  const now = new Date();

  if (!found || isExpired(found, ttlDays, now)) throw failedTokenEntry(token, attempt);
  await refundTokenAttempt(client.ipKey, attempt);
  if (signedInAccountIds.includes(found.id)) throw new ApiError("ALREADY_SIGNED_IN");

  const sessionId = newSessionId();
  await db().$transaction(async (tx) => {
    // Values written with a rotated-out key are upgraded on the next sign-in.
    if (needsReencryption(found.tokenEnc, keys) || found.tokenLookup !== tokenLookups(token, keys)[0]) {
      await updateAccountToken(tx, found.id, { tokenLookup: tokenLookups(token, keys)[0]!, tokenEnc: bytes(encryptToken(token, keys)) });
    }
    await touchAccountLogin(tx, found.id, now);
    await createSession(tx, { id: sessionId, accountId: found.id, ...sessionFields(client) });
  });
  const { tokenEnc: _enc, tokenLookup: _lookup, ...account } = found;
  return { account, sessionId };
}

/**
 * Admin re-authentication: the signed-in account's own token, entered again on this session,
 * unlocks admin actions for AUTH.reauthWindowMin. Wrong tokens count toward the same lockout
 * as sign-in.
 */
export async function reauthenticate(sessionId: string, accountId: string, token: string, client: ClientInfo): Promise<void> {
  const attempt = await startTokenEntry(client);
  const found = token.length === ID_LENGTH.token ? await findAccountByLookups(db(), tokenLookups(token, tokenKeys())) : null;
  if (found?.id !== accountId) throw failedTokenEntry(token, attempt);
  await refundTokenAttempt(client.ipKey, attempt);
  await markReauthenticated(db(), sessionId, new Date());
}

/** Ends one device session; the database flag makes it invalid everywhere immediately. */
export async function signOut(sessionId: string): Promise<void> {
  await revokeSession(db(), sessionId, new Date());
}

/** Full token for the owner (profile "Show" / "Save token"). */
export async function revealToken(accountId: string): Promise<string> {
  const row = await findAccountToken(db(), accountId);
  if (!row) throw new ApiError("NOT_FOUND");
  try {
    return decryptToken(row.tokenEnc, tokenKeys());
  } catch (error) {
    logger.error("token decryption failed", { accountId, error });
    throw new ApiError("INTERNAL");
  }
}

/**
 * Replaces the account token: the old one stops working at once and every other device is
 * signed out (design "Generate a new token"). Returns the new token to show once.
 */
export async function regenerateToken(accountId: string, keepSessionId: string): Promise<string> {
  const keys = tokenKeys();
  return retryOnUniqueViolation(async () => {
    const token = newAccountToken();
    await db().$transaction(async (tx) => {
      await updateAccountToken(tx, accountId, { tokenLookup: tokenLookups(token, keys)[0]!, tokenEnc: bytes(encryptToken(token, keys)) });
      await revokeOtherSessions(tx, accountId, keepSessionId, new Date());
    });
    return token;
  });
}
