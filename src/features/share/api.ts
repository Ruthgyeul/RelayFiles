import { filesApi } from "@/features/files/api";
import { withVisibility } from "@/features/files/settings";
import { ApiClientError, apiFetch } from "@/shared/lib/api-client";

const base = (linkId: string) => `/api/share/${encodeURIComponent(linkId)}`;

/** URLs the browser loads directly from a share page. */
export const shareUrls = {
  stream: (linkId: string, id: string) => `${base(linkId)}/files/${encodeURIComponent(id)}/stream`,
  download: (linkId: string, id: string) => `${base(linkId)}/files/${encodeURIComponent(id)}/download`,
  zip: (linkId: string, folderId: string) => `${base(linkId)}/zip?folder=${encodeURIComponent(folderId)}`,
};

export const shareApi = {
  unlock: (linkId: string, password: string) => apiFetch<{ unlocked: true }>(`${base(linkId)}/unlock`, { method: "POST", json: { password } }),

  /** Owner preview "Make public": saves the current settings with visibility public. */
  makePublic: async (nodeId: string) => {
    const { item } = await filesApi.getProperties(nodeId);
    await filesApi.saveSettings(nodeId, withVisibility(item.settings, "public"));
  },

  /**
   * Starts a download after asking the server (HEAD, not counted) whether it would be
   * served, so a busy or blocked file shows a message instead of an error page.
   */
  download: async (url: string): Promise<string | null> => {
    const check = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (!check) return "Connection lost";
    if (!check.ok) return check.status === 429 ? "Server busy · downloads for this file are paused" : check.status === 403 ? "Download limit reached" : "Something went wrong.";
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    anchor.click();
    return null;
  },
};

export const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");
