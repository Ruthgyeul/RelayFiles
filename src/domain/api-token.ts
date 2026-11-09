import { API, MS } from "@/config/policy";
import { ID_PATTERN } from "./ids";

/** The token of an `Authorization: Bearer <token>` header when it has the personal token format, else null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  const token = match?.[1];
  return token && ID_PATTERN.apiToken.test(token) ? token : null;
}

/** The token id inside a personal token (which row to check it against). */
export function apiTokenIdOf(token: string): string | null {
  return ID_PATTERN.apiToken.exec(token)?.[1] ?? null;
}

/** Whether a token with `scopes` may do what `needed` names. */
export function hasScope(scopes: readonly string[], needed: string): boolean {
  return scopes.includes(needed);
}

/** A token past its expiry date no longer works (null: no expiry). */
export function tokenExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt <= now;
}

/** Times of a token as epoch milliseconds (null: never used / no expiry). */
export interface TokenUse {
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

/**
 * Why a token deserves a look: it stops working soon, nobody has used it for
 * API.staleAfterDays, or it was never used in its first API.unusedAfterDays. A token
 * that already expired counts as expiring (it no longer works and should be replaced).
 */
export type TokenHealth = "ok" | "expiring" | "stale" | "unused";

export function tokenHealth(token: TokenUse, now: number): TokenHealth {
  if (token.expiresAt !== null && token.expiresAt - now <= API.expiringWarnDays * MS.day) return "expiring";
  if (token.lastUsedAt !== null) return now - token.lastUsedAt >= API.staleAfterDays * MS.day ? "stale" : "ok";
  return now - token.createdAt >= API.unusedAfterDays * MS.day ? "unused" : "ok";
}

const HEALTH_TEXT: Record<Exclude<TokenHealth, "ok">, string> = {
  expiring: "Expires soon",
  stale: `Not used for ${API.staleAfterDays} days`,
  unused: "Never used",
};

/** The warning shown next to a token, or null when there is nothing to say. */
export function tokenHealthText(health: TokenHealth): string | null {
  return health === "ok" ? null : HEALTH_TEXT[health];
}
