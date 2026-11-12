import "server-only";
import { SCAN } from "@/config/policy";
import { permanentScanError } from "@/domain/scan";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { enqueueMedia, enqueueScan } from "../jobs/queue";
import { queueNotification } from "../jobs/notify-queue";
import { logger } from "../logger";
import { findAccountById } from "../repositories/account.repo";
import { findNodeForJob, setScanState } from "../repositories/node.repo";
import { scanFile, scanningEnabled } from "../scan/clamd";
import { locationOf } from "./node-location";
import { deleteItems, requireNode, type NodeOwner } from "./node-ops.service";
import { driverForAccount } from "./volume.service";

export type ScanOutcome = "clean" | "infected" | "failed";

/**
 * Scans one file received through an upload-only link (docs/security.md "업로드 링크 검사").
 * Clean: visitors may get it and its thumbnails are made. Infected: moved to the trash as
 * INFECTED (never restorable) and the owner is told. Too large or refused by clamd: FAILED, so
 * it is never shared. clamd down or timed out: throws, and the job is tried again.
 */
export async function runScan(nodeId: string): Promise<ScanOutcome | null> {
  const row = await findNodeForJob(db(), nodeId);
  if (!row || row.type !== "FILE" || row.scanState !== "PENDING") return null;
  const account = await findAccountById(db(), row.accountId);
  if (!account) return null;
  if (row.size > BigInt(SCAN.maxBytes)) {
    await setScanState(db(), row.id, "FAILED", "PENDING");
    return "failed";
  }
  const driver = await driverForAccount(account);
  const path = await driver.localPath(await locationOf(row.accountId, row.id));
  if (!path) throw new Error("Scanning needs a local volume.");
  const verdict = await scanFile(path, Number(row.size));

  // Deleted or replaced while it was scanned: nothing to record.
  const current = await findNodeForJob(db(), row.id);
  if (!current || current.sha256 !== row.sha256 || current.scanState !== "PENDING") return null;
  switch (verdict.state) {
    case "clean":
      await setScanState(db(), row.id, "CLEAN", "PENDING");
      if (row.kind === "IMAGE" || row.kind === "VIDEO") void enqueueMedia([row.id]);
      return "clean";
    case "infected":
      logger.warn("malware found in an uploaded file", { nodeId: row.id, signature: verdict.signature });
      await deleteItems(account, [row.id], { malware: verdict.signature });
      void queueNotification({ kind: "file-infected", owner: account.name, item: row.name, signature: verdict.signature }, `file-infected-${row.id}`);
      return "infected";
    case "error":
      if (!permanentScanError(verdict.message)) throw new Error(`clamd: ${verdict.message}`);
      logger.warn("file could not be scanned", { nodeId: row.id, reason: verdict.message });
      await setScanState(db(), row.id, "FAILED", "PENDING");
      return "failed";
  }
}

/** The last try of a scan failed (clamd unreachable all along): the file is not shared until a rescan. */
export async function giveUpScan(nodeId: string): Promise<void> {
  await setScanState(db(), nodeId, "FAILED", "PENDING");
}

/** "Scan again" for a file whose scan failed (clamd was down, or since raised its size limit). */
export async function rescan(owner: NodeOwner, nodeId: string): Promise<void> {
  if (!scanningEnabled()) throw new ApiError("BAD_REQUEST", "Virus scanning is not set up on this server.");
  const row = await requireNode(owner.id, nodeId);
  if (row.type !== "FILE" || row.scanState !== "FAILED") throw new ApiError("BAD_REQUEST", "Only files whose scan failed can be scanned again.");
  await setScanState(db(), row.id, "PENDING");
  await enqueueScan([row.id]);
}
