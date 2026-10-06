import type { ThemeKey } from "@/config/theme";
import type { SignupMode } from "@/contracts/auth";
import type { AnnouncementLevel } from "@/contracts/server-settings";
import { apiFetch } from "@/shared/lib/api-client";

/** Server page settings calls. */
export const settingsApi = {
  publish: (text: string, level: AnnouncementLevel) => apiFetch<{ published: true }>("/api/admin/announcement", { method: "POST", json: { text, level } }),
  takeDown: () => apiFetch<{ removed: true }>("/api/admin/announcement", { method: "DELETE" }),
  signupMode: (mode: SignupMode) => apiFetch<{ mode: SignupMode }>("/api/admin/settings/signup", { method: "PUT", json: { mode } }),
  theme: (theme: ThemeKey) => apiFetch<{ theme: ThemeKey }>("/api/admin/settings/theme", { method: "PUT", json: { theme } }),
  newInvite: () => apiFetch<{ code: string }>("/api/admin/invites", { method: "POST" }),
  revokeInvite: (code: string) => apiFetch<{ revoked: true }>(`/api/admin/invites/${encodeURIComponent(code)}`, { method: "DELETE" }),
};
