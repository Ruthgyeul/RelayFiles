import type { CleanupResult, ManageInput } from "@/contracts/admin";
import { apiFetch } from "@/shared/lib/api-client";

const account = (id: string) => `/api/admin/accounts/${encodeURIComponent(id)}`;

export const adminApi = {
  manage: (id: string, input: ManageInput) => apiFetch<{ updated: true }>(account(id), { method: "PATCH", json: input }),
  deleteAccount: (id: string) => apiFetch<{ deleted: true }>(account(id), { method: "DELETE" }),
  cleanup: () => apiFetch<CleanupResult>("/api/admin/cleanup", { method: "POST" }),
};
