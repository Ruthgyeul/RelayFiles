import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import type { SharePage } from "@/contracts/share";
import { clientInfo } from "../auth/client-info";
import { retiredSharePage, sharePage } from "../services/share.service";
import { logLinkEvent } from "./events";
import { currentShareViewer } from "./viewer";

/**
 * The share page for the current request; null when the link (or folder) does not exist.
 * Links whose items expired and were deleted still answer with the "expired" card.
 * A visitor opening the top of an open link is logged as "Opened link" after the response.
 */
export async function sharePageForRequest(linkId: string, folderId: string | null): Promise<SharePage | null> {
  const now = Date.now();
  const result = await sharePage(linkId, folderId, await currentShareViewer(now), now);
  if (!result) return folderId ? null : retiredSharePage(linkId);
  const { page, link } = result;
  if (page.status === "open" && !page.owner && !folderId) {
    const client = clientInfo(await headers());
    after(() => logLinkEvent(link.root, "OPEN", client));
  }
  return page;
}
