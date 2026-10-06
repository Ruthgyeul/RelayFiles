import "server-only";
import { getEnv } from "@/config/env";
import type { SignupMode } from "@/contracts/auth";
import { accountColor, isExpired } from "@/domain/account";
import { ID_LENGTH, newAccountId, newAccountToken, newAnonName, newLinkId, newNodeId, newSessionId } from "@/domain/ids";
import { failureMessage } from "@/domain/lockout";
import type { ClientInfo } from "../auth/client-info";
import { tokenKeys } from "../auth/keys";
import { allowSignup, clearFailures, lockoutPolicy, lockRemaining, recordFailure } from "../auth/login-limiter";
import { decryptToken, encryptToken, needsReencryption, tokenLookups } from "../auth/token-crypto";
import { db, Prisma } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { createAccount, findAccountByLookups, findAccountToken, touchAccountLogin, updateAccountToken, type AccountRow } from "../repositories/account.repo";
import { createRootFolder } from "../repositories/node.repo";
import { consumeInvite, getServerConfig } from "../repositories/server-config.repo";
import { createSession, revokeSession } from "../repositories/session.repo";
import { withStorageTransaction } from "../storage/storage-transaction";
import { volumeForNewAccount } from "./volume.service";

/** Random ids collide practically never; a unique violation is retried with fresh ids. */
const CREATE_ATTEMPTS = 3;
const BYTES_PER_GB = 1_000_000_000;

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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
 * left behind in the database or on disk (docs/plan.md §13.1).
 */
async function provisionAccount({ isAdmin, inviteCode, client }: ProvisionOptions): Promise<ProvisionedAccount> {
  const driver = await volumeForNewAccount();
  const keys = tokenKeys();
  const quotaGb = getEnv("policy").DEFAULT_QUOTA_GB;

  for (let attempt = 1; ; attempt++) {
    const id = newAccountId();
    const name = newAnonName();
    const token = newAccountToken();
    const now = new Date();
    try {
      return await withStorageTransaction(db(), async (tx, undo) => {
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
    } catch (error) {
      if (isUniqueViolation(error) && attempt < CREATE_ATTEMPTS) continue;
      throw error;
    }
  }
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
 * Signs in with a pasted token. Failures are counted per client address and lock sign-in
 * on the design's ladder (5 attempts → 30 s, 120 s, 600 s).
 */
export async function signInWithToken(token: string, client: ClientInfo, signedInAccountIds: readonly string[]): Promise<SignedIn> {
  const locked = await lockRemaining(client.ipKey);
  if (locked > 0) throw new ApiError("RATE_LIMITED", `Too many failed attempts. Try again in ${locked} s.`, { retryAfter: locked });

  const keys = tokenKeys();
  const found = token.length === ID_LENGTH.token ? await findAccountByLookups(db(), tokenLookups(token, keys)) : null;
  const ttlDays = getEnv("policy").ACCOUNT_TTL_DAYS;
  const now = new Date();

  if (!found || isExpired(found, ttlDays, now)) {
    const policy = lockoutPolicy();
    const { failures, lockSeconds } = await recordFailure(client.ipKey, policy);
    if (lockSeconds > 0) throw new ApiError("RATE_LIMITED", "Too many failed attempts.", { retryAfter: lockSeconds });
    throw new ApiError("INVALID_TOKEN", failureMessage(token, failures, policy, ID_LENGTH.token));
  }
  if (signedInAccountIds.includes(found.id)) throw new ApiError("ALREADY_SIGNED_IN");

  await clearFailures(client.ipKey);
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
