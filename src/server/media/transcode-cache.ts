import "server-only";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { getEnv } from "@/config/env";
import { TRANSCODE } from "@/config/policy";
import { db } from "../db/client";
import { sendFile } from "../http/send-file";
import { enqueueTranscode } from "../jobs/queue";
import { logger } from "../logger";
import { countOne } from "../metrics/counters";
import { redis } from "../redis";
import { findAccountById } from "../repositories/account.repo";
import { findNodeForJob } from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import type { StorageDriver } from "../storage/driver";
import { availableAboveReserve } from "../storage/registry";
import { locationOf } from "../services/node-location";
import { driverForAccount } from "../services/volume.service";
import { sharedSlot, storedTranscodeArgs } from "./transcode";

/**
 * Stored conversions of videos the browser cannot decode (docs/architecture.md "미디어"):
 * live conversion costs CPU for every viewer, so a video converted live TRANSCODE.cacheAfterPlays
 * times within cacheWindowSec is converted once by the worker into system/transcoded and
 * played from that file afterwards, with Range requests like any file. The original is not
 * touched; the stored file has no metadata and does not count toward any quota.
 */

const playsKey = (nodeId: string) => `transcode:plays:${nodeId}`;

/** The stored conversion of a video as a ranged playback response, or null when there is none yet. */
export async function sendStoredTranscode(req: Request, driver: StorageDriver, accountId: string, row: { id: string; name: string; sha256: string | null }): Promise<Response | null> {
  const source = await driver.assetSource({ kind: "transcode", accountId, nodeId: row.id });
  if (!source) return null;
  if (req.method === "GET") void countOne("transcode_cache_hits");
  return sendFile(req, {
    driver,
    location: { accountId, segments: [] },
    name: `${row.name.replace(/\.[^.]+$/, "")}.mp4`,
    mime: "video/mp4",
    size: source.size,
    etag: `${row.sha256 ?? row.id}-mp4`,
    mode: "stream",
    body: source,
  });
}

/** Counts a live conversion of a video; once it is played often enough, the worker stores one. Never fails the request. */
export async function notePlay(nodeId: string): Promise<void> {
  try {
    const [[, plays]] = (await redis().multi().incr(playsKey(nodeId)).expire(playsKey(nodeId), TRANSCODE.cacheWindowSec, "NX").exec()) as [[Error | null, number]];
    if (plays === TRANSCODE.cacheAfterPlays) await enqueueTranscode(nodeId);
  } catch (error) {
    logger.warn("video play not counted", { error });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getEnv("jobs").FFMPEG_PATH, args, { stdio: "ignore", shell: false });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

/**
 * Worker job: converts a video into a stored MP4 using one of the shared conversion slots
 * (so live viewers and the worker together stay within VIDEO_TRANSCODE_MAX). Skipped when the
 * video is gone or the volume would dip into its reserve; all slots busy is a retry.
 */
export async function storeTranscode(nodeId: string): Promise<boolean> {
  const row = await findNodeForJob(db(), nodeId);
  if (!row || row.type !== "FILE" || row.kind !== "VIDEO") return false;
  const account = await findAccountById(db(), row.accountId);
  const volume = account ? await findVolume(db(), account.volumeId) : null;
  if (!account || !volume) return false;
  const driver = await driverForAccount(account, "write");
  const path = await driver.localPath(await locationOf(row.accountId, row.id));
  if (!path) return false;
  const space = await driver.space();
  // The conversion is at most about as large as a 720p copy; never fill the volume's reserve for it.
  if (availableAboveReserve(space.total, space.available, volume.reservePct) < row.size) return false;

  const slot = await sharedSlot(getEnv("jobs").VIDEO_TRANSCODE_MAX);
  if (!slot) throw new Error("all conversion slots are busy; retrying later");
  const temp = await driver.stagingPath();
  try {
    await runFfmpeg(storedTranscodeArgs(path, temp));
    // Deleted or replaced while converting: keep nothing.
    const current = await findNodeForJob(db(), row.id);
    if (!current || current.sha256 !== row.sha256) return false;
    await driver.adoptAsset({ kind: "transcode", accountId: row.accountId, nodeId: row.id }, temp);
    return true;
  } finally {
    await slot.release();
    await rm(temp, { force: true });
  }
}
