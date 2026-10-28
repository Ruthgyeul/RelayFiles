import type { CreateFileRequestInput, FileRequestDto } from "@/contracts/file-requests";
import { apiFetch } from "@/shared/lib/api-client";

/** The owner's side of upload-only links. */
export const fileRequestsApi = {
  list: (folderId: string) => apiFetch<FileRequestDto[]>(`/api/file-requests?folder=${encodeURIComponent(folderId)}`),
  create: (input: CreateFileRequestInput) => apiFetch<FileRequestDto>("/api/file-requests", { method: "POST", json: input }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/api/file-requests/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
