import type { IncidentInput, StatusData } from "@/contracts/status";
import { apiFetch } from "@/shared/lib/api-client";

/** Status page calls. */
export const statusApi = {
  get: () => apiFetch<StatusData>("/api/status", { cache: "no-store" }),
  post: (input: IncidentInput) => apiFetch<{ id: string }>("/api/admin/incidents", { method: "POST", json: input }),
  edit: (id: string, input: IncidentInput) => apiFetch<{ saved: true }>(`/api/admin/incidents/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/api/admin/incidents/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
