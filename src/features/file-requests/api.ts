import type { RequestUploadInput, RequestUploadPlan } from "@/contracts/file-requests";
import { apiFetch } from "@/shared/lib/api-client";

const base = (id: string) => `/api/r/${encodeURIComponent(id)}`;

/** A visitor's calls on an upload-only link. */
export const requestApi = {
  unlock: (id: string, password: string) => apiFetch<{ unlocked: true }>(`${base(id)}/unlock`, { method: "POST", json: { password } }),
  prepare: (id: string, files: RequestUploadInput["files"]) => apiFetch<RequestUploadPlan>(`${base(id)}/uploads`, { method: "POST", json: { files } }),
};
