import { apiFetch } from "@/shared/lib/api-client";

/** "Shared by me": changes (the list comes from the server render). */
export const sharesApi = { makePrivate: (ids: string[]) => apiFetch<{ updated: number }>("/api/shares/private", { method: "POST", json: { ids } }) };
