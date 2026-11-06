import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { SHARE } from "@/config/policy";
import type { SharePage } from "@/contracts/share";
import { clientInfo, requestIp } from "../auth/client-info";
import { countInWindow, redis } from "../redis";
import { retiredSharePage, sharePage } from "./share.service";
import { logLinkEvent } from "./events";
import { currentShareViewer } from "./viewer";

/**
 * The share page for the current request; null when the link (or folder) does not exist, or
 * is private and the visitor is not its owner.
 * Links whose items expired and were deleted still answer with the "expired" card.
 * A visitor opening the top of an open link is logged as "Opened link" after the response.
 */
export async function sharePageForRequest(linkId: string, folderId: string | null): Promise<SharePage | null> {
  const now = Date.now();
  const requestHeaders = await headers();
  const client = clientInfo(requestHeaders);
  // Requests without a proxy address (local development) all share one key: they are not limited.
  const missKey = requestIp(requestHeaders) ? `share:miss:${client.ipKey}` : null;
  // An address that looked up many links that do not exist gets "not found" for every link for a while.
  if (missKey && Number((await redis().get(missKey)) ?? 0) >= SHARE.linkMissesPerAddress) return null;
  const missed = async () => {
    if (missKey) await countInWindow(missKey, SHARE.linkMissWindowSec);
    return null;
  };
  const result = await sharePage(linkId, folderId, await currentShareViewer(now), now);
  if (!result) return folderId ? missed() : ((await retiredSharePage(linkId)) ?? missed());
  const { page, link } = result;
  // To anyone but the owner a private link looks like one that does not exist: a "This link is
  // private" card would tell someone guessing ids that they found a real one.
  if (page.status === "private" && !page.owner) return missed();
  if (page.status === "open" && !page.owner && !folderId) after(() => logLinkEvent(link.root, "OPEN", client));
  return page;
}
