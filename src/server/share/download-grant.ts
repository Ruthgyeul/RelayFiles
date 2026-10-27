import "server-only";
import { MS, SHARE } from "@/config/policy";
import { redis } from "../redis";

/**
 * A visitor's counted start of a file (download, or playback of a limited file), which lets
 * that browser (`rf_dv`, visitor-cookie.ts) resume it without being counted again
 * (domain `downloadDecision`).
 */
const keyOf = (nodeId: string, visitorId: string) => `dl:grant:${nodeId}:${visitorId}`;
const GRANT_SECONDS = (SHARE.downloadGrantHours * MS.hour) / MS.second;

export async function grantDownload(nodeId: string, visitorId: string): Promise<void> {
  await redis().set(keyOf(nodeId, visitorId), "1", "EX", GRANT_SECONDS);
}

export async function hasDownloadGrant(nodeId: string, visitorId: string | null): Promise<boolean> {
  if (!visitorId) return false;
  return (await redis().exists(keyOf(nodeId, visitorId))) === 1;
}
