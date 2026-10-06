import "server-only";
import { mimeFromName } from "@/domain/upload";
import { db } from "../db/client";
import { sendFile } from "../files/send-file";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { ancestorChain, findNode } from "../repositories/node.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { driverForAccount } from "./volume.service";

type Owner = Pick<AccountRow, "id" | "volumeId">;

/** The owner's own download or playback of a file (always the original bytes). */
export async function serveOwnFile(req: Request, owner: Owner, nodeId: string, mode: "download" | "stream"): Promise<Response> {
  const row = await findNode(db(), owner.id, nodeId);
  if (!row || row.type !== "FILE") throw new ApiError("NOT_FOUND");
  const chain = await ancestorChain(db(), row.id);
  const driver = await driverForAccount(owner);
  const location = { accountId: owner.id, segments: chain.slice(1).map((ancestor) => ancestor.name) };
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
