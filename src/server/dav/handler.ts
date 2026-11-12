import "server-only";
import { DAV } from "@/config/policy";
import { davDepth, davMultistatus, davSegments, type DavEntry } from "@/domain/dav";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { findChildByName, findRootFolder, listChildren, type NodeRow } from "../repositories/node.repo";
import { requireApiCaller, type ApiCaller } from "../services/api-token.service";
import { serveOwnFile } from "../services/file.service";

/** Methods this read-only server answers (writes come with the next release). */
const ALLOW = "OPTIONS, PROPFIND, GET, HEAD";
const REALM = 'Basic realm="RelayFiles", charset="UTF-8"';
const XML = "application/xml; charset=utf-8";

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/**
 * The API token a client sent: the password of Basic auth (the user name is ignored, so a file
 * manager can save "relayfiles" and the token) or a Bearer token.
 */
export function davToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, value] = authorization.split(" ", 2);
  if (scheme?.toLowerCase() === "bearer") return value?.trim() || null;
  if (scheme?.toLowerCase() !== "basic" || !value) return null;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : decoded.slice(colon + 1) || null;
}

async function callerOf(req: Request): Promise<ApiCaller> {
  const token = davToken(req.headers.get("authorization"));
  if (!token) throw new ApiError("UNAUTHORIZED");
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${token}`);
  return requireApiCaller(headers, "files:read", new Date(), { key: "dav", perMinute: DAV.requestsPerMinute });
}

/** The item at `segments` below the account root (folders on the way only), or null. */
async function resolve(accountId: string, segments: readonly string[]): Promise<NodeRow | null> {
  let row = await findRootFolder(db(), accountId);
  for (const name of segments) {
    if (!row || row.type !== "FOLDER") return null;
    row = await findChildByName(db(), row.id, name);
  }
  return row;
}

const entryOf = (row: NodeRow, segments: string[], name: string): DavEntry => ({
  segments,
  folder: row.type === "FOLDER",
  name,
  size: row.size,
  mime: row.mime,
  etag: row.sha256,
  createdAt: row.createdAt,
  modifiedAt: row.modifiedAt ?? row.createdAt,
});

async function propfind(req: Request, row: NodeRow, segments: string[]): Promise<Response> {
  const depth = davDepth(req.headers.get("depth"));
  if (depth === "infinity") {
    return new Response('<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>\n', { status: 403, headers: { "content-type": XML } });
  }
  const entries = [entryOf(row, segments, segments.at(-1) ?? row.name)];
  if (row.type === "FOLDER" && depth === "1") {
    // A replaced file's row steps aside under a name with "/" for a moment; it is never listed.
    const children = (await listChildren(db(), row.id)).filter((child) => !child.name.includes("/")).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) entries.push(entryOf(child, [...segments, child.name], child.name));
  }
  return new Response(davMultistatus(DAV.prefix, entries), { status: 207, headers: { "content-type": XML, "cache-control": "no-store" } });
}

/**
 * One WebDAV request (npm run dav): OPTIONS, PROPFIND (Depth 0 or 1) and GET/HEAD of files,
 * for the account of the personal API token (files:read). Other accounts' items do not exist
 * here: paths start at the token's own root. Writes answer 405 for now.
 */
export async function davHandler(req: Request): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: { DAV: "1", Allow: ALLOW, "MS-Author-Via": "DAV" } });
    const caller = await callerOf(req);
    if (!["PROPFIND", "GET", "HEAD"].includes(req.method)) return text(405, "This server is read-only.", { Allow: ALLOW });
    const segments = davSegments(new URL(req.url).pathname, DAV.prefix);
    if (segments === null) return text(404, "Not found");
    const row = await resolve(caller.account.id, segments);
    if (!row) return text(404, "Not found");
    switch (req.method) {
      case "PROPFIND":
        return await propfind(req, row, segments);
      case "GET":
      case "HEAD":
        if (row.type === "FOLDER") return text(405, "Folders are listed with PROPFIND.", { Allow: ALLOW });
        return await serveOwnFile(req, caller.account, row.id, "download");
      default:
        return text(405, "This server is read-only.", { Allow: ALLOW });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      const headers: Record<string, string> = error.status === 401 ? { "WWW-Authenticate": REALM } : {};
      if (error.options.retryAfter) headers["Retry-After"] = String(error.options.retryAfter);
      return text(error.status, error.message, headers);
    }
    logger.error("dav request failed", { method: req.method, error });
    return text(500, "Something went wrong.");
  }
}
