import "server-only";
import { mimeFromName } from "@/domain/upload";
import { db } from "../db/client";
import { sendFile } from "../http/send-file";
import { sendAsset, sendThumb } from "../http/send-thumb";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { transcodeResponse } from "../media/transcode";
import { notePlay, sendStoredTranscode } from "../media/transcode-cache";
import type { AccountRow } from "../repositories/account.repo";
import { findNode } from "../repositories/node.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { driverForAccount } from "./volume.service";
import { locationOf } from "./node-location";
import { markActive } from "../metrics/activity";

type Owner = Pick<AccountRow, "id" | "volumeId">;

/** The owner's own download or playback of a file (always the original bytes). */
export async function serveOwnFile(req: Request, owner: Owner, nodeId: string, mode: "download" | "stream"): Promise<Response> {
  const row = await findNode(db(), owner.id, nodeId);
  if (!row || row.type !== "FILE") throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner);
  const location = await locationOf(owner.id, row.id);
  if (mode === "stream" && req.method === "GET") void markActive("stream", `${row.id}:${owner.id}`);
  return sendFile(req, {
    driver,
    location,
    name: row.name,
    mime: row.mime ?? mimeFromName(row.name),
    size: Number(row.size),
    etag: row.sha256,
    mode,
    onServe: (bytes) => {
      if (req.method === "HEAD" || bytes === 0) return;
      addTraffic(db(), owner.id, BigInt(bytes), new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
    },
  });
}

/** The owner's thumbnail (WebP), with an ETag tied to the file contents. */
export async function serveOwnThumb(req: Request, owner: Owner, nodeId: string): Promise<Response> {
  const row = await findNode(db(), owner.id, nodeId);
  if (!row || row.type !== "FILE" || !row.hasThumb) throw new ApiError("NOT_FOUND");
  return sendThumb(req, await driverForAccount(owner), owner.id, row);
}

/**
 * What the viewer shows for the owner's image: the worker's screen-sized preview, or the
 * original while there is none (small files, GIFs, not processed yet).
 */
export async function serveOwnPreview(req: Request, owner: Owner, nodeId: string): Promise<Response> {
  const row = await findNode(db(), owner.id, nodeId);
  if (!row || row.type !== "FILE") throw new ApiError("NOT_FOUND");
  const preview = row.kind === "IMAGE" ? await sendAsset(req, await driverForAccount(owner), owner.id, row, "preview") : null;
  return preview ?? serveOwnFile(req, owner, nodeId, "stream");
}

/** The owner's video converted while it plays (containers the browser cannot decode). */
export async function serveOwnTranscode(req: Request, owner: Owner, nodeId: string): Promise<Response> {
  const row = await findNode(db(), owner.id, nodeId);
  if (!row || row.type !== "FILE" || row.kind !== "VIDEO") throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner);
  if (req.method === "GET") void markActive("stream", `${row.id}:${owner.id}`);
  const stored = await sendStoredTranscode(req, driver, owner.id, row);
  if (stored) return stored;
  const path = await driver.localPath(await locationOf(owner.id, row.id));
  if (!path) throw new ApiError("NOT_FOUND");
  if (req.method === "GET") void notePlay(row.id);
  return transcodeResponse(req, path);
}
