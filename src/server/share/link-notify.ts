import "server-only";
import { MS, NOTIFY } from "@/config/policy";
import { db } from "../db/client";
import { queueNotification, queueThrottled, notifyEnabled } from "../jobs/notify-queue";
import { logger } from "../logger";
import { findLinkNotifyOwner } from "../repositories/account.repo";
import type { UsedUpItem } from "../repositories/share.repo";

/**
 * Owner notifications about share links (docs/runbook.md "알림 설정"), for owners who turned
 * them on (Account.notifyLinkEvents): a link opened (at most once per link per
 * NOTIFY.linkOpenRememberDays), and a download that used up an item's downloads. They run off
 * the download path (never awaited, never throwing) and name only the item, never the link,
 * the visitor's address or anything else about the visitor but its country.
 */

/** The owner's name when it wants these notifications and a webhook is set, else null. */
async function optedInOwner(accountId: string): Promise<string | null> {
  if (!notifyEnabled()) return null;
  const owner = await findLinkNotifyOwner(db(), accountId);
  return owner?.notifyLinkEvents ? owner.name : null;
}

function inBackground(work: () => Promise<unknown>): void {
  void work().catch((error: unknown) => logger.warn("link notification not queued", { error }));
}

/** A visitor opened the top of a link (share page). */
export function noteLinkOpened(root: { accountId: string; linkId: string; name: string; type: "FILE" | "FOLDER" }, country: string | null): void {
  inBackground(async () => {
    const owner = await optedInOwner(root.accountId);
    if (!owner) return;
    // Keyed by the link, so a link sent again (regenerated) is reported on its first open too.
    await queueThrottled({ kind: "link-opened", owner, item: root.name, folder: root.type === "FOLDER", country }, root.linkId, NOTIFY.linkOpenRememberDays * MS.day);
  });
}

/** Items a counted download used up (share.repo claimDownload / claimEachDownload). */
export function noteUsedUp(accountId: string, items: readonly UsedUpItem[]): void {
  if (items.length === 0) return;
  inBackground(async () => {
    const owner = await optedInOwner(accountId);
    if (!owner) return;
    // The download count is in the id: the same item used up again after a reset is new news.
    for (const item of items) await queueNotification({ kind: "link-used-up", owner, item: item.name, cause: item.cause, downloads: item.downloads }, `link-used-up-${item.id}-${item.downloads}`);
  });
}
