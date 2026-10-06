import type { CreatedAccount, SessionState } from "@/contracts/auth";
import { apiFetch } from "@/shared/lib/api-client";

/** Account API calls used by the sign-in flow and the account switcher. */
export interface AccountApi {
  getSession(): Promise<SessionState>;
  createAnonymous(inviteCode?: string): Promise<CreatedAccount>;
  signInWithToken(token: string): Promise<SessionState>;
  switchAccount(accountId: string): Promise<SessionState>;
  signOut(accountId?: string): Promise<SessionState>;
  revealToken(accountId?: string): Promise<string>;
}

export const accountApi: AccountApi = {
  getSession: () => apiFetch<SessionState>("/api/auth/session"),
  createAnonymous: (inviteCode) => apiFetch<CreatedAccount>("/api/auth/anonymous", { method: "POST", json: { inviteCode } }),
  signInWithToken: (token) => apiFetch<SessionState>("/api/auth/token", { method: "POST", json: { token } }),
  switchAccount: (accountId) => apiFetch<SessionState>("/api/auth/switch", { method: "POST", json: { accountId } }),
  signOut: (accountId) => apiFetch<SessionState>("/api/auth/signout", { method: "POST", json: { accountId } }),
  revealToken: async (accountId) => (await apiFetch<{ token: string }>(accountId ? `/api/me/token?accountId=${encodeURIComponent(accountId)}` : "/api/me/token")).token,
};
