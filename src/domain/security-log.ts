/**
 * Vocabulary of the account's own security log: what is recorded and the English text the
 * profile shows for it. Only events whose account is known are recorded: a wrong account
 * token at sign-in matches no account, so it is never in anyone's log (docs/security.md).
 */

export const SECURITY_EVENTS = [
  "account.created",
  "signin",
  "signout",
  "device.signout",
  "devices.signout",
  "token.regenerated",
  "reauth",
  "reauth.failed",
  "apiToken.created",
  "apiToken.revoked",
  "apiToken.rejected",
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

export const isSecurityEvent = (value: string): value is SecurityEvent => (SECURITY_EVENTS as readonly string[]).includes(value);

const LABEL: Record<SecurityEvent, string> = {
  "account.created": "Account created",
  signin: "Signed in with the token",
  signout: "Signed out",
  "device.signout": "Signed out another device",
  "devices.signout": "Signed out all other devices",
  "token.regenerated": "Generated a new token",
  reauth: "Confirmed it's you",
  "reauth.failed": "Wrong token when confirming it's you",
  "apiToken.created": "Created API token",
  "apiToken.revoked": "Revoked API token",
  "apiToken.rejected": "API token refused",
};

/** Events the profile marks as a warning: someone may be trying a token that isn't theirs. */
const WARNINGS: ReadonlySet<SecurityEvent> = new Set(["reauth.failed", "apiToken.rejected"]);

export function securityEventLabel(kind: SecurityEvent): string {
  return LABEL[kind];
}

export function isSecurityWarning(kind: SecurityEvent): boolean {
  return WARNINGS.has(kind);
}

/** "Windows · Chrome · KR · 203.0.x.x": where an entry came from, the parts that are known. */
export function securityEventOrigin(entry: { os: string; browser: string; country: string | null; ipMasked: string }): string {
  return [`${entry.os} · ${entry.browser}`, entry.country, entry.ipMasked].filter((part): part is string => Boolean(part)).join(" · ");
}

/** The detail of "Generated a new token": how many API tokens it revoked, when any. */
export function revokedTokensDetail(count: number): string | undefined {
  if (count <= 0) return undefined;
  return `${count} API ${count === 1 ? "token" : "tokens"} revoked`;
}

/** The detail of "Signed out all other devices". */
export function signedOutDetail(count: number): string {
  return `${count} ${count === 1 ? "device" : "devices"}`;
}
