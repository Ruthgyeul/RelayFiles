import "server-only";
import { MS, SHARE } from "@/config/policy";
import { redis } from "../redis";

/**
 * A visitor's counted start of a file (download, or playback of a limited file) through one
 * link, which lets that browser (`rf_dv`, visitor-cookie.ts) resume it there without being
 * counted again (domain `downloadDecision`). Keyed by the link too: a start counted through
 * one link (and its limits) never continues through another, whose limits it did not count on.
 */
const keyOf = (linkId: string, nodeId: string, visitorId: string) => `dl:grant:${linkId}:${nodeId}:${visitorId}`;
const GRANT_SECONDS = (SHARE.downloadGrantHours * MS.hour) / MS.second;

export async function grantDownload(linkId: string, nodeId: string, visitorId: string): Promise<void> {
  await redis().set(keyOf(linkId, nodeId, visitorId), "1", "EX", GRANT_SECONDS);
}

export async function hasDownloadGrant(linkId: string, nodeId: string, visitorId: string | null): Promise<boolean> {
  if (!visitorId) return false;
  return (await redis().exists(keyOf(linkId, nodeId, visitorId))) === 1;
}
