import "server-only";
import { rm } from "node:fs/promises";
import { getEnv } from "@/config/env";
import { MS, TRANSCODE } from "@/config/policy";
import { db } from "../db/client";
import { sendFile } from "../http/send-file";
import { enqueueTranscode } from "../jobs/queue";
import { logger } from "../logger";
import { countOne } from "../metrics/counters";
import { redis } from "../redis";
import { findAccountById } from "../repositories/account.repo";
import { findNodeForJob } from "../repositories/node.repo";
import { findVolume } from "../repositories/volume.repo";
import { CommandError, runCommand } from "../process/run-command";
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

/**
 * Runs the stored conversion through runCommand: stopped (SIGTERM, then SIGKILL) after
 * TRANSCODE.storeTimeoutSec, or as soon as `signal` aborts. Resolves false on a timeout.
 */
async function convert(path: string, output: string, signal: AbortSignal): Promise<boolean> {
  try {
    await runCommand(getEnv("jobs").FFMPEG_PATH, storedTranscodeArgs(path, output), { timeoutMs: TRANSCODE.storeTimeoutSec * MS.second, signal });
    return true;
  } catch (error) {
    if (error instanceof CommandError && error.reason === "timeout") return false;
    throw error;
  }
}

/**
 * Worker job: converts a video into a stored MP4 using one of the shared conversion slots
 * (so live viewers and the worker together stay within VIDEO_TRANSCODE_MAX). Skipped when the
 * video is gone or the volume would dip into its reserve; all slots busy is a retry.
 * ffmpeg stops when `signal` aborts (the worker is stopping) or the slot is lost; both are
 * errors, so the job is tried again later. A conversion past TRANSCODE.storeTimeoutSec is
 * not retried (it would only time out again): live conversion keeps working, and the video
 * is queued again once it is played often enough in a later window.
 */
export async function storeTranscode(nodeId: string, signal?: AbortSignal): Promise<boolean> {
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
    if (!(await convert(path, temp, signal ? AbortSignal.any([signal, slot.signal]) : slot.signal))) {
      logger.warn("stored video conversion took too long; not retried", { nodeId: row.id });
      return false;
    }
    // Deleted or replaced while converting: keep nothing.
    const current = await findNodeForJob(db(), row.id);
    if (!current || current.sha256 !== row.sha256) return false;
    await driver.adoptAsset({ kind: "transcode", accountId: row.accountId, nodeId: row.id }, temp);
    return true;
  } finally {
    // An unreachable Redis must not hide the job's own error; the slot then lapses with its lease.
    await slot.release().catch((error: unknown) => logger.warn("conversion slot not released", { error }));
    await rm(temp, { force: true });
  }
}
