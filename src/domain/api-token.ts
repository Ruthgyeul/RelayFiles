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
