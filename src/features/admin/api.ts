import type { AuditPage, CleanupResult, ManageInput } from "@/contracts/admin";
import type { AuditGroup } from "@/domain/audit";
import { apiFetch } from "@/shared/lib/api-client";

const account = (id: string) => `/api/admin/accounts/${encodeURIComponent(id)}`;

export interface AuditRequest {
  cursor?: string;
  group?: AuditGroup;
  account?: string;
}

const auditUrl = ({ cursor, group, account: accountId }: AuditRequest) => {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (group) query.set("group", group);
  if (accountId) query.set("account", accountId);
  const text = query.toString();
  return text ? `/api/admin/audit?${text}` : "/api/admin/audit";
};

export const adminApi = {
  manage: (id: string, input: ManageInput) => apiFetch<{ updated: true }>(account(id), { method: "PATCH", json: input }),
  deleteAccount: (id: string) => apiFetch<{ deleted: true }>(account(id), { method: "DELETE" }),
  cleanup: () => apiFetch<CleanupResult>("/api/admin/cleanup", { method: "POST" }),
  audit: (request: AuditRequest) => apiFetch<AuditPage>(auditUrl(request)),
};
