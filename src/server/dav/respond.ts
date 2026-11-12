import "server-only";
import { db } from "../db/client";
import { findChildByName, findRootFolder, type NodeRow } from "../repositories/node.repo";

export const XML = "application/xml; charset=utf-8";

/** A short plain-text answer that is never cached. */
export const davText = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/** An empty answer (201, 204). */
export const davEmpty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

/** The item at `segments` below the account root (folders on the way only), or null. */
export async function resolveDav(accountId: string, segments: readonly string[]): Promise<NodeRow | null> {
  let row = await findRootFolder(db(), accountId);
  for (const name of segments) {
    if (!row || row.type !== "FOLDER") return null;
    row = await findChildByName(db(), row.id, name);
  }
  return row;
}

/** Reads a request body to the end without keeping it (the connection stays usable). */
export async function drainBody(req: Request): Promise<void> {
  if (!req.body) return;
  const reader = req.body.getReader();
  while (!(await reader.read()).done);
}
