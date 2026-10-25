import "server-only";
import { MS, SHARE } from "@/config/policy";
import { redis } from "../redis";

/** A visitor's counted download start of a file, which lets them resume it (domain `downloadDecision`). */
const keyOf = (nodeId: string, ipKey: string) => `dl:grant:${nodeId}:${ipKey}`;
const GRANT_SECONDS = (SHARE.downloadGrantHours * MS.hour) / MS.second;

export async function grantDownload(nodeId: string, ipKey: string): Promise<void> {
  await redis().set(keyOf(nodeId, ipKey), "1", "EX", GRANT_SECONDS);
}

export async function hasDownloadGrant(nodeId: string, ipKey: string): Promise<boolean> {
  return (await redis().exists(keyOf(nodeId, ipKey))) === 1;
}
