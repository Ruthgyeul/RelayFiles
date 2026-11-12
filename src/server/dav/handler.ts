import "server-only";
import { DAV } from "@/config/policy";
import type { ApiScope } from "@/contracts/api-tokens";
import { davSegments } from "@/domain/dav";
import { ApiError, DISK_IN_THE_WAY_MESSAGE } from "../http/api-error";
import { StorageTargetExistsError } from "../storage/driver";
import { logger } from "../logger";
import { requireApiCaller, type ApiCaller } from "../services/api-token.service";
import { serveOwnFile } from "../services/file.service";
import { propfind } from "./read";
import { davText, resolveDav } from "./respond";
import { lock, mkcol, proppatch, put, remove, transfer, unlock } from "./write";

const READS = new Set(["PROPFIND", "GET", "HEAD"]);
const WRITES = new Set(["PUT", "MKCOL", "DELETE", "MOVE", "COPY", "LOCK", "UNLOCK", "PROPPATCH"]);
const ALLOW = ["OPTIONS", ...READS, ...WRITES].join(", ");
const REALM = 'Basic realm="RelayFiles", charset="UTF-8"';

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

async function callerOf(req: Request, scope: ApiScope): Promise<ApiCaller> {
  const token = davToken(req.headers.get("authorization"));
  if (!token) throw new ApiError("UNAUTHORIZED");
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${token}`);
  return requireApiCaller(headers, scope, new Date(), { key: "dav", perMinute: DAV.requestsPerMinute });
}

async function read(req: Request, caller: ApiCaller, segments: string[]): Promise<Response> {
  const row = await resolveDav(caller.account.id, segments);
  if (!row) return davText(404, "Not found");
  if (req.method === "PROPFIND") return propfind(req, row, segments);
  if (row.type === "FOLDER") return davText(405, "Folders are listed with PROPFIND.", { Allow: ALLOW });
  return serveOwnFile(req, caller.account, row.id, "download");
}

function write(req: Request, caller: ApiCaller, segments: string[]): Promise<Response> | Response {
  const owner = caller.account;
  switch (req.method) {
    case "PUT":
      return put(req, owner, segments);
    case "MKCOL":
      return mkcol(req, owner, segments);
    case "DELETE":
      return remove(owner, segments);
    case "MOVE":
      return transfer(req, owner, segments, "move");
    case "COPY":
      return transfer(req, owner, segments, "copy");
    case "LOCK":
      return lock(req, owner, segments);
    case "UNLOCK":
      return unlock(req);
    default:
      return proppatch(req, owner, segments);
  }
}

/**
 * One WebDAV request (npm run dav) for the account of the personal API token: reads need
 * files:read, changes files:write. Other accounts' items do not exist here: paths start at the
 * token's own root. Changes go through the same services as the web app (quota, item limit,
 * versions of replaced files, "Recently deleted").
 */
export async function davHandler(req: Request): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: { DAV: "1, 2", Allow: ALLOW, "MS-Author-Via": "DAV" } });
    const reading = READS.has(req.method);
    if (!reading && !WRITES.has(req.method)) {
      await callerOf(req, "files:read");
      return davText(405, "This method is not supported.", { Allow: ALLOW });
    }
    const caller = await callerOf(req, reading ? "files:read" : "files:write");
    const segments = davSegments(new URL(req.url).pathname, DAV.prefix);
    if (segments === null) return davText(404, "Not found");
    return await (reading ? read(req, caller, segments) : write(req, caller, segments));
  } catch (error) {
    if (error instanceof ApiError) {
      const headers: Record<string, string> = error.status === 401 ? { "WWW-Authenticate": REALM } : {};
      if (error.options.retryAfter) headers["Retry-After"] = String(error.options.retryAfter);
      return davText(error.status, error.message, headers);
    }
    if (error instanceof StorageTargetExistsError) return davText(409, DISK_IN_THE_WAY_MESSAGE);
    logger.error("dav request failed", { method: req.method, error });
    return davText(500, "Something went wrong.");
  }
}
