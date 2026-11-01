import "server-only";
import { STORAGE } from "@/config/policy";
import { segmentsBelowRoot } from "@/domain/tree";
import { db, type DbClient } from "../db/client";
import { ancestorChain, lockAncestorChain } from "../repositories/node-tree.repo";
import type { StorageLocation } from "../storage/driver";

/** Storage location of a node: its folder names below the account root. */
export async function locationOf(accountId: string, nodeId: string): Promise<StorageLocation> {
  return { accountId, segments: segmentsBelowRoot(await ancestorChain(db(), nodeId)) };
}

/**
 * The storage location of a node inside a transaction, with the node and its folders locked
 * (FOR SHARE) until it ends: nothing on the path can be renamed, moved or deleted meanwhile, so
 * the location stays right for a disk operation in the same transaction (an upload linking to
 * an existing file with the same content). Null when the node is gone.
 */
export async function lockedLocationOf(tx: DbClient, accountId: string, nodeId: string): Promise<StorageLocation | null> {
  const chain = await lockAncestorChain(tx, nodeId, STORAGE.subtreeLockAttempts);
  return chain ? { accountId, segments: segmentsBelowRoot(chain) } : null;
}
