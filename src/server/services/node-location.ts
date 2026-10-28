import "server-only";
import { segmentsBelowRoot } from "@/domain/tree";
import { db } from "../db/client";
import { ancestorChain } from "../repositories/node.repo";
import type { StorageLocation } from "../storage/driver";

/** Storage location of a node: its folder names below the account root. */
export async function locationOf(accountId: string, nodeId: string): Promise<StorageLocation> {
  return { accountId, segments: segmentsBelowRoot(await ancestorChain(db(), nodeId)) };
}
