import "server-only";
import { rm } from "node:fs/promises";
import { getEnv } from "@/config/env";
import { MEDIA, MS } from "@/config/policy";
import { BYTES_PER_GB } from "@/domain/quota";
import type { StripMode } from "@/domain/image-metadata";
import { keptVideoTags, videoStripArgs } from "@/domain/video-metadata";
import { db } from "../db/client";
import { runCommand } from "../process/run-command";
import { findVolume } from "../repositories/volume.repo";
import type { AssetRef, StorageDriver } from "../storage/driver";
import { availableAboveReserve } from "../storage/registry";
import { videoMetadata } from "./date-taken";
import { ffmpegInput } from "./ffmpeg-input";

/**
 * Writes the shared copy of a video: the same streams (copied, not re-encoded) without
 * container, stream or chapter metadata, with only the capture time and device written back
 * in `sensitive` mode (domain/video-metadata.ts). Returns false for a video that cannot get one
 * (an unknown container, or larger than MEDIA.maxVideoStripBytes); throws on storage trouble
 * (no room above the volume's reserve, a failed write), so the job is tried again later.
 */
export async function writeVideoStrippedCopy(driver: StorageDriver, asset: Omit<AssetRef, "kind">, input: { path: string; mime: string; size: number; volumeId: string }, mode: StripMode): Promise<boolean> {
  if (input.size > MEDIA.maxVideoStripBytes) return false;
  const temp = await driver.stagingPath();
  const args = videoStripArgs(ffmpegInput(input.path), temp, input.mime, keptVideoTags(await videoMetadata(input.path), mode));
  if (!args) return false;
  const volume = await findVolume(db(), input.volumeId);
  const space = await driver.space();
  if (!volume || availableAboveReserve(space.total, space.available, volume.reservePct) < BigInt(input.size)) throw new Error("no room for the video's shared copy; retrying later");
  try {
    const timeoutMs = (MEDIA.ffmpegTimeoutSec + Math.ceil(input.size / BYTES_PER_GB) * MEDIA.videoStripSecPerGb) * MS.second;
    await runCommand(getEnv("jobs").FFMPEG_PATH, args, { timeoutMs });
    await driver.adoptAsset({ ...asset, kind: "derived" }, temp);
    return true;
  } finally {
    await rm(temp, { force: true });
  }
}
