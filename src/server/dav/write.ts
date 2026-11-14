import "server-only";
import { randomUUID } from "node:crypto";
import { DAV } from "@/config/policy";
import { davDepth, davDestination, davHref, davLockDiscovery, davLockTimeout, davLockTokenOf, davOverwrite, davProppatchResult, davWithin, isMacMetadata } from "@/domain/dav";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { findChildByName, type NodeRow } from "../repositories/node.repo";
import type { AccountRow } from "../repositories/account.repo";
import { uploadWholeFile } from "../services/direct-upload.service";
import { moveOverFile } from "../services/file-version.service";
import { createFolder } from "../services/node.service";
import { deleteItems, renameNode } from "../services/node-ops.service";
import { copyNodes, moveNodes } from "../services/transfer.service";
import { davEmpty, davText, drainBody, resolveDav, XML } from "./respond";

type Owner = AccountRow;

const skipped = (name: string | undefined) => DAV.skipMacMetadata && name !== undefined && isMacMetadata(name);

/** The folder an item at `segments` goes into, or null when it is missing (409 for the caller). */
async function parentOf(accountId: string, segments: readonly string[]): Promise<NodeRow | null> {
  const parent = await resolveDav(accountId, segments.slice(0, -1));
  return parent?.type === "FOLDER" ? parent : null;
}

/**
 * Bytes the client will send: Content-Length, or X-Expected-Entity-Length that Finder sends
 * with a chunked body. Null when neither is a whole number.
 */
function bodySize(headers: Headers): number | null {
  for (const name of ["content-length", "x-expected-entity-length"]) {
    const value = headers.get(name)?.trim();
    if (value && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

const emptyBody = () => new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });

/** PUT: a new file, or a new version of the file already at that path. */
export async function put(req: Request, owner: Owner, segments: string[]): Promise<Response> {
  const name = segments.at(-1);
  if (name === undefined) return davText(405, "The root is a folder.");
  if (skipped(name)) {
    await drainBody(req);
    return davEmpty(201);
  }
  const parent = await parentOf(owner.id, segments);
  if (!parent) return davText(409, "The folder does not exist.");
  const existing = await findChildByName(db(), parent.id, name);
  if (existing?.type === "FOLDER") return davText(405, "A folder has this name.");
  const size = bodySize(req.headers);
  if (size === null) return davText(411, "Send Content-Length.");
  await uploadWholeFile(owner, parent.id, name, size, req.body ?? emptyBody(), "replace");
  return davEmpty(existing ? 204 : 201);
}

/** MKCOL: a new folder (the name must be free; MKCOL has no body). */
export async function mkcol(req: Request, owner: Owner, segments: string[]): Promise<Response> {
  const name = segments.at(-1);
  if (name === undefined) return davText(405, "The root exists.");
  if (bodySize(req.headers) || req.headers.has("transfer-encoding")) return davText(415, "MKCOL takes no body.");
  const parent = await parentOf(owner.id, segments);
  if (!parent) return davText(409, "The folder does not exist.");
  if (await findChildByName(db(), parent.id, name)) return davText(405, "Something already has this name.");
  await createFolder(owner, parent.id, name);
  return davEmpty(201);
}

/** DELETE: to "Recently deleted", like the web app. */
export async function remove(owner: Owner, segments: string[]): Promise<Response> {
  if (segments.length === 0) return davText(403, "The root can't be deleted.");
  const row = await resolveDav(owner.id, segments);
  if (!row) return skipped(segments.at(-1)) ? davEmpty(204) : davText(404, "Not found");
  await deleteItems(owner, [row.id]);
  return davEmpty(204);
}

/** A name no client chooses, for an item while it waits to replace another (`.relayfiles-replacing-<id>`). */
const replacingName = () => `.relayfiles-replacing-${randomUUID().slice(0, DAV.replacingIdLength)}`;

/**
 * Puts an item in place of `existing` (Overwrite: T) without losing it when that fails: `place`
 * first puts the new item next to it under a temporary name and returns its id, then the old item
 * goes (to Recently deleted, as any delete) and the new one takes its name. A copy refused on the
 * quota, the item limit or a busy volume leaves the destination untouched.
 */
async function replaceWith(owner: Owner, existing: NodeRow, name: string, place: (temporary: string) => Promise<string>): Promise<void> {
  const id = await place(replacingName());
  try {
    await deleteItems(owner, [existing.id]);
  } catch (error) {
    // The old item stays: take the new one away again, so nothing is left under the temporary name.
    await deleteItems(owner, [id], { recoverable: false }).catch(() => undefined);
    throw error;
  }
  await renameNode(owner, id, name);
}

/** The id of what a move or copy just put into `parentId` as `name`. */
async function placedId(owner: Owner, parentId: string, name: string): Promise<string> {
  const row = await findChildByName(db(), parentId, name);
  if (!row || row.accountId !== owner.id) throw new ApiError("CONFLICT", "The item changed meanwhile. Try again.");
  return row.id;
}

/**
 * MOVE and COPY within the account. The destination's folder must exist; an item already there
 * is replaced unless Overwrite is F (412). Nothing can go into itself (409).
 */
export async function transfer(req: Request, owner: Owner, segments: string[], mode: "move" | "copy"): Promise<Response> {
  if (segments.length === 0) return davText(403, "The root can't be moved or copied.");
  const source = await resolveDav(owner.id, segments);
  if (!source) return davText(404, "Not found");
  const destination = davDestination(req.headers.get("destination"), DAV.prefix);
  if (!destination) return davText(400, "Destination must be a path on this server.");
  const name = destination.at(-1);
  if (name === undefined || davWithin(destination, segments) || davWithin(segments, destination)) {
    // The same path, the root, or a folder into itself (or over one of its own folders).
    return davText(name === undefined || destination.length === segments.length ? 403 : 409, "Can't move or copy there.");
  }
  const parent = await parentOf(owner.id, destination);
  if (!parent) return davText(409, "The destination folder does not exist.");
  const existing = await findChildByName(db(), parent.id, name);
  if (existing && !davOverwrite(req.headers.get("overwrite"))) return davText(412, "Something already has this name.");
  const status = existing ? 204 : 201;

  if (mode === "move") {
    // A file moved over a file keeps the old one as a version.
    if (existing?.type === "FILE" && source.type === "FILE") {
      await moveOverFile(owner, source, existing);
      return davEmpty(status);
    }
    const moveTo = async (to: string) => {
      if (source.parentId === parent.id) await renameNode(owner, source.id, to);
      else await moveNodes(owner, [source.id], parent.id, { names: new Map([[source.id, to]]) });
      return source.id;
    };
    if (existing) await replaceWith(owner, existing, name, moveTo);
    else await moveTo(name);
    return davEmpty(status);
  }
  const copyTo = async (to: string) => {
    // Depth 0 copies a folder without what is inside.
    if (source.type === "FOLDER" && davDepth(req.headers.get("depth")) === "0") return (await createFolder(owner, parent.id, to)).folder.id;
    await copyNodes(owner, [source.id], parent.id, { names: new Map([[source.id, to]]) });
    return placedId(owner, parent.id, to);
  };
  if (existing) await replaceWith(owner, existing, name, copyTo);
  else await copyTo(name);
  return davEmpty(status);
}

/**
 * LOCK: Finder and Windows mount a drive read-only without it. Locks are advisory (one person's
 * files): a token is handed out and refreshed but not enforced. A missing file is created empty.
 */
export async function lock(req: Request, owner: Owner, segments: string[]): Promise<Response> {
  const timeout = davLockTimeout(req.headers.get("timeout"), DAV.lockTimeoutSeconds);
  const refreshed = davLockTokenOf(req.headers.get("if"));
  await drainBody(req);
  let row = await resolveDav(owner.id, segments);
  let status = 200;
  if (!row && !skipped(segments.at(-1))) {
    const name = segments.at(-1);
    const parent = await parentOf(owner.id, segments);
    if (name === undefined || !parent) return davText(409, "The folder does not exist.");
    await uploadWholeFile(owner, parent.id, name, 0, emptyBody(), "keep");
    row = await findChildByName(db(), parent.id, name);
    status = 201;
  }
  const token = refreshed ?? `opaquelocktoken:${randomUUID()}`;
  const depth = davDepth(req.headers.get("depth")) === "0" ? "0" : "infinity";
  const body = davLockDiscovery(davHref(DAV.prefix, segments, row?.type === "FOLDER"), token, timeout, depth);
  return new Response(body, { status, headers: { "content-type": XML, "Lock-Token": `<${token}>` } });
}

/** UNLOCK: nothing is held, so any token the client names is released. */
export function unlock(req: Request): Response {
  if (!davLockTokenOf(req.headers.get("lock-token"))) return davText(400, "Send Lock-Token.");
  return davEmpty(204);
}

/** PROPPATCH: answered as done; custom properties are not stored. */
export async function proppatch(req: Request, owner: Owner, segments: string[]): Promise<Response> {
  await drainBody(req);
  const row = await resolveDav(owner.id, segments);
  if (!row) {
    if (skipped(segments.at(-1))) return new Response(davProppatchResult(davHref(DAV.prefix, segments, false)), { status: 207, headers: { "content-type": XML } });
    throw new ApiError("NOT_FOUND");
  }
  return new Response(davProppatchResult(davHref(DAV.prefix, segments, row.type === "FOLDER")), { status: 207, headers: { "content-type": XML } });
}
