/**
 * Admin audit log vocabulary: the recorded actions, the groups the admin screen filters by
 * and the English text each entry is shown with.
 */

/** Admin actions written to the audit log. */
export const AUDIT_ACTIONS = [
  "account.manage",
  "account.delete",
  "signup.mode",
  "cleanup.run",
  "invite.create",
  "invite.revoke",
  "token.reveal",
  "token.regenerate",
  "announcement.publish",
  "announcement.remove",
  "theme.set",
  "incident.post",
  "incident.edit",
  "incident.delete",
  "apiToken.create",
  "apiToken.revoke",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const isAuditAction = (value: string): value is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(value);

/** Filter groups of the audit log screen ("Accounts", "Sign-up", ...). */
export const AUDIT_GROUPS = [
  { key: "accounts", label: "Accounts", actions: ["account.manage", "account.delete", "cleanup.run"] },
  { key: "signup", label: "Sign-up", actions: ["signup.mode", "invite.create", "invite.revoke"] },
  { key: "tokens", label: "Tokens", actions: ["token.reveal", "token.regenerate", "apiToken.create", "apiToken.revoke"] },
  { key: "server", label: "Server", actions: ["announcement.publish", "announcement.remove", "theme.set", "incident.post", "incident.edit", "incident.delete"] },
] as const satisfies readonly { key: string; label: string; actions: readonly AuditAction[] }[];
export type AuditGroup = (typeof AUDIT_GROUPS)[number]["key"];
export const AUDIT_GROUP_KEYS = AUDIT_GROUPS.map((group) => group.key) as [AuditGroup, ...AuditGroup[]];

/** The actions of a filter group. */
export function auditGroupActions(group: AuditGroup): readonly AuditAction[] {
  return AUDIT_GROUPS.find((entry) => entry.key === group)?.actions ?? [];
}

const ACTION_LABEL: Record<AuditAction, string> = {
  "account.manage": "Changed account settings",
  "account.delete": "Deleted account",
  "signup.mode": "Changed sign-up mode",
  "cleanup.run": "Ran cleanup",
  "invite.create": "Created invite code",
  "invite.revoke": "Revoked invite code",
  "token.reveal": "Viewed admin token",
  "token.regenerate": "Regenerated admin token",
  "announcement.publish": "Published announcement",
  "announcement.remove": "Removed announcement",
  "theme.set": "Changed theme",
  "incident.post": "Posted incident",
  "incident.edit": "Edited incident",
  "incident.delete": "Deleted incident",
  "apiToken.create": "Created API token",
  "apiToken.revoke": "Revoked API token",
};

/** What an entry did, as the audit log screen shows it. */
export function auditActionLabel(action: AuditAction): string {
  return ACTION_LABEL[action];
}

/** "Target · detail" of an entry, the parts that are set; null when neither is. */
export function auditTargetText(entry: { targetId: string | null; detail: string | null }): string | null {
  const parts = [entry.targetId, entry.detail].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
