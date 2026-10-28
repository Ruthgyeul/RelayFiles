import "server-only";
import { timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { getEnv } from "@/config/env";
import { API, MS } from "@/config/policy";
import { ADMIN_ONLY_SCOPES, API_SCOPES, type ApiScope, type ApiTokenDto, type CreateApiTokenInput, type CreatedApiToken } from "@/contracts/api-tokens";
import { isExpired } from "@/domain/account";
import { apiTokenIdOf, bearerToken, hasScope, tokenExpired } from "@/domain/api-token";
import { newApiToken, newApiTokenId } from "@/domain/ids";
import { db } from "../db/client";
import { retryOnUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { countInWindow } from "../redis";
import type { AccountRow } from "../repositories/account.repo";
import { countApiTokens, createApiTokenRow, deleteApiToken, findApiTokenWithAccount, listApiTokenRows, touchApiToken } from "../repositories/api-token.repo";

/** Seconds in the rate-limit window (API.requestsPerMinute). */
const RATE_WINDOW_SEC = MS.minute / MS.second;

/** What a /api/v1 handler acts as: the token's account and what the token may do. */
export interface ApiCaller {
  account: AccountRow;
  tokenId: string;
  scopes: readonly ApiScope[];
}

/**
 * Tokens this process checked against their argon2 hash lately, by token id, so a busy script
 * costs one hash per API.verifyCacheSec instead of one per request. The row is still read on
 * every request, so a revoked or expired token stops working at once.
 */
const verified = new Map<string, { token: Buffer; until: number }>();

function verifiedRecently(id: string, token: string, now: number): boolean {
  const entry = verified.get(id);
  if (!entry || entry.until <= now) return false;
  const given = Buffer.from(token);
  return given.length === entry.token.length && timingSafeEqual(given, entry.token);
}

function rememberVerified(id: string, token: string, now: number): void {
  if (verified.size >= API.verifyCacheMax) verified.delete(verified.keys().next().value!);
  verified.set(id, { token: Buffer.from(token), until: now + API.verifyCacheSec * MS.second });
}

async function tokenMatches(id: string, token: string, secretHash: string, now: number): Promise<boolean> {
  if (verifiedRecently(id, token, now)) return true;
  if (!(await verify(secretHash, token).catch(() => false))) return false;
  rememberVerified(id, token, now);
  return true;
}

const isScope = (value: string): value is ApiScope => (API_SCOPES as readonly string[]).includes(value);

function toDto(row: { id: string; name: string; scopes: string[]; createdAt: Date; expiresAt: Date | null; lastUsedAt: Date | null }): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes.filter(isScope),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export async function listApiTokens(accountId: string): Promise<ApiTokenDto[]> {
  return (await listApiTokenRows(db(), accountId)).map(toDto);
}

/** A new token for the account, returned in full once; admin-only scopes need an admin. */
export async function createApiToken(account: Pick<AccountRow, "id" | "isAdmin">, input: CreateApiTokenInput, now: Date = new Date()): Promise<CreatedApiToken> {
  if (!account.isAdmin && input.scopes.some((scope) => ADMIN_ONLY_SCOPES.includes(scope))) throw new ApiError("FORBIDDEN");
  if ((await countApiTokens(db(), account.id)) >= API.maxTokensPerAccount) {
    throw new ApiError("BAD_REQUEST", `An account can hold at most ${API.maxTokensPerAccount} API tokens. Revoke one first.`);
  }
  return retryOnUniqueViolation(async () => {
    const id = newApiTokenId();
    const token = newApiToken(id);
    const row = await createApiTokenRow(db(), {
      id,
      accountId: account.id,
      name: input.name,
      secretHash: await hash(token),
      scopes: [...new Set(input.scopes)],
      expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * MS.day),
    });
    return { token, item: toDto(row) };
  });
}

export async function revokeApiToken(accountId: string, id: string): Promise<void> {
  if (!(await deleteApiToken(db(), accountId, id))) throw new ApiError("NOT_FOUND");
  verified.delete(id);
}

/**
 * The caller of a /api/v1 request: a valid `Authorization: Bearer` token (401 otherwise) of a
 * live account, holding `scope` when one is named (403), under its per-minute request limit (429). Cookies are
 * never read here, so these routes cannot be driven by another site through a browser.
 */
export async function requireApiCaller(headers: Headers, scope: ApiScope | null, now: Date = new Date()): Promise<ApiCaller> {
  const token = bearerToken(headers.get("authorization"));
  const id = token ? apiTokenIdOf(token) : null;
  const row = id ? await findApiTokenWithAccount(db(), id) : null;
  if (!token || !row || !(await tokenMatches(row.id, token, row.secretHash, now.getTime())) || tokenExpired(row.expiresAt?.getTime() ?? null, now.getTime()) || isExpired(row.account, getEnv("policy").ACCOUNT_TTL_DAYS, now)) {
    throw new ApiError("UNAUTHORIZED", "Missing, unknown or expired API token.");
  }
  if (scope !== null && !hasScope(row.scopes, scope)) throw new ApiError("FORBIDDEN", `This token lacks the ${scope} scope.`);
  if ((await countInWindow(`api:rate:${row.id}`, RATE_WINDOW_SEC)) > API.requestsPerMinute) {
    throw new ApiError("RATE_LIMITED", "Too many requests with this token. Try again in a minute.", { retryAfter: RATE_WINDOW_SEC });
  }
  await touchApiToken(db(), row.id, now, new Date(now.getTime() - API.touchIntervalSec * MS.second));
  return { account: row.account, tokenId: row.id, scopes: row.scopes.filter(isScope) };
}
