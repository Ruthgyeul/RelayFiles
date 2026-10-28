import "server-only";
import { createHash } from "node:crypto";
import { getEnv } from "@/config/env";
import { API, MS } from "@/config/policy";
import { ADMIN_ONLY_SCOPES, API_SCOPES, type ApiScope, type ApiTokenDto, type CreateApiTokenInput, type CreatedApiToken } from "@/contracts/api-tokens";
import { isExpired } from "@/domain/account";
import { bearerToken, hasScope, tokenExpired } from "@/domain/api-token";
import { newApiToken, newApiTokenId } from "@/domain/ids";
import { db } from "../db/client";
import { retryOnUniqueViolation } from "../db/errors";
import { ApiError } from "../http/api-error";
import { countInWindow } from "../redis";
import type { AccountRow } from "../repositories/account.repo";
import { countApiTokens, createApiTokenRow, deleteApiToken, findApiTokenByLookup, listApiTokenRows, touchApiToken } from "../repositories/api-token.repo";

/** Seconds in the rate-limit window (API.requestsPerMinute). */
const RATE_WINDOW_SEC = MS.minute / MS.second;

/** What a /api/v1 handler acts as: the token's account and what the token may do. */
export interface ApiCaller {
  account: AccountRow;
  tokenId: string;
  scopes: readonly ApiScope[];
}

/** Tokens hold 256 random bits, so a plain SHA-256 identifies them without a key to rotate. */
const lookupOf = (token: string) => createHash("sha256").update(token).digest("hex");

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
    const token = newApiToken();
    const row = await createApiTokenRow(db(), {
      id: newApiTokenId(),
      accountId: account.id,
      name: input.name,
      lookup: lookupOf(token),
      scopes: [...new Set(input.scopes)],
      expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * MS.day),
    });
    return { token, item: toDto(row) };
  });
}

export async function revokeApiToken(accountId: string, id: string): Promise<void> {
  if (!(await deleteApiToken(db(), accountId, id))) throw new ApiError("NOT_FOUND");
}

/**
 * The caller of a /api/v1 request: a valid `Authorization: Bearer` token (401 otherwise) of a
 * live account, holding `scope` when one is named (403), under its per-minute request limit (429). Cookies are
 * never read here, so these routes cannot be driven by another site through a browser.
 */
export async function requireApiCaller(headers: Headers, scope: ApiScope | null, now: Date = new Date()): Promise<ApiCaller> {
  const token = bearerToken(headers.get("authorization"));
  const row = token ? await findApiTokenByLookup(db(), lookupOf(token)) : null;
  if (!row || tokenExpired(row.expiresAt?.getTime() ?? null, now.getTime()) || isExpired(row.account, getEnv("policy").ACCOUNT_TTL_DAYS, now)) {
    throw new ApiError("UNAUTHORIZED", "Missing, unknown or expired API token.");
  }
  if (scope !== null && !hasScope(row.scopes, scope)) throw new ApiError("FORBIDDEN", `This token lacks the ${scope} scope.`);
  if ((await countInWindow(`api:rate:${row.id}`, RATE_WINDOW_SEC)) > API.requestsPerMinute) {
    throw new ApiError("RATE_LIMITED", "Too many requests with this token. Try again in a minute.", { retryAfter: RATE_WINDOW_SEC });
  }
  await touchApiToken(db(), row.id, now, new Date(now.getTime() - API.touchIntervalSec * MS.second));
  return { account: row.account, tokenId: row.id, scopes: row.scopes.filter(isScope) };
}
