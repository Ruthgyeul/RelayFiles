import type { ApiTokenDto, CreateApiTokenInput, CreatedApiToken } from "@/contracts/api-tokens";
import type { SessionState } from "@/contracts/auth";
import type { DeviceDto, Preferences } from "@/contracts/profile";
import { apiFetch } from "@/shared/lib/api-client";

/** My Profile calls (the page itself is rendered on the server and refreshed after changes). */
export const profileApi = {
  devices: () => apiFetch<DeviceDto[]>("/api/me/sessions"),
  signOutDevice: (sessionId: string) => apiFetch<{ signedOut: true }>(`/api/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  signOutOthers: () => apiFetch<{ signedOut: number }>("/api/me/sessions", { method: "DELETE" }),
  newToken: () => apiFetch<{ token: string; account: { id: string; name: string } }>("/api/me/token", { method: "POST" }),
  savePreferences: (preferences: Preferences) => apiFetch<Preferences>("/api/me/preferences", { method: "PATCH", json: preferences }),
  purgeExpired: () => apiFetch<{ deleted: number }>("/api/me/purge", { method: "POST" }),
  apiTokens: () => apiFetch<ApiTokenDto[]>("/api/me/api-tokens"),
  createApiToken: (input: CreateApiTokenInput) => apiFetch<CreatedApiToken>("/api/me/api-tokens", { method: "POST", json: input }),
  revokeApiToken: (id: string) => apiFetch<{ revoked: true }>(`/api/me/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteAccount: () => apiFetch<SessionState>("/api/me", { method: "DELETE" }),
};
