import "server-only";
import { mimeFromName } from "@/domain/upload";
import { db } from "../db/client";
import { sendFile } from "../files/send-file";
import { sendThumb } from "../files/send-thumb";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { ancestorChain, findNode } from "../repositories/node.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { driverForAccount } from "./volume.service";
import { markActive } from "../metrics/activity";

type Owner = Pick<AccountRow, "id" | "volumeId">;

/** The owner's own download or playback of a file (always the original bytes). */
export async function serveOwnFile(req: Request, owner: Owner, nodeId: string, mode: "download" | "stream"): Promise<Response> {
  const row = await findNode(db(), owner.id, nodeId);
  if (!row || row.type !== "FILE") throw new ApiError("NOT_FOUND");
  const chain = await ancestorChain(db(), row.id);
  const driver = await driverForAccount(owner);
  const location = { accountId: owner.id, segments: chain.slice(1).map((ancestor) => ancestor.name) };
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
