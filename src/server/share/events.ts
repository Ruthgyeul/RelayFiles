import "server-only";
import { SHARE } from "@/config/policy";
import { db } from "../db/client";
import type { ClientInfo } from "../auth/client-info";
import { logger } from "../logger";
import { redis } from "../redis";
import { addLinkEvent, trimLinkEvents } from "../repositories/node.repo";

export type LinkEventKind = "OPEN" | "PLAY" | "VIEW" | "DOWNLOAD";

/**
 * Adds an entry to a link's activity log (design `logEv`): device, masked address and
 * country only. Opens and plays are logged once per visitor and item in a window, so a page
 * refresh or a seek does not flood the log. Failures are logged, never shown to visitors.
 */
export async function logLinkEvent(node: { id: string; name: string }, kind: LinkEventKind, client: ClientInfo): Promise<void> {
  try {
    if (kind !== "DOWNLOAD") {
      const fresh = await redis().set(`ev:${kind}:${node.id}:${client.ipKey}:${client.os}:${client.browser}`, "1", "EX", SHARE.eventDedupeSec, "NX");
      if (fresh === null) return;
    }
    await addLinkEvent(db(), {
      nodeId: node.id,
      kind,
      fileName: node.name,
      device: `${client.os} · ${client.browser}`,
      ipMasked: client.ipMasked,
      country: client.country ?? "",
    });
    await trimLinkEvents(db(), node.id, SHARE.eventsKeptPerNode);
  } catch (error) {
    logger.warn("link event not recorded", { kind, error });
  }
}
