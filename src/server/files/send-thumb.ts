import "server-only";
import { Readable } from "node:stream";
import { MEDIA } from "@/config/policy";
import { ApiError } from "../http/api-error";
import type { StorageDriver } from "../storage/driver";

/**
 * A generated thumbnail (WebP, re-encoded without metadata) with an ETag tied to the file
 * contents. Used for the owner's list and for share pages.
 */
export async function sendThumb(req: Request, driver: StorageDriver, accountId: string, row: { id: string; sha256: string | null }): Promise<Response> {
  const etag = `"${row.sha256 ?? row.id}-thumb"`;
  const headers = new Headers({
    "content-type": "image/webp",
    "cache-control": `private, max-age=${MEDIA.thumbMaxAgeSec}`,
    "x-content-type-options": "nosniff",
    etag,
  });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const asset = await driver.readAsset({ kind: "thumb", accountId, nodeId: row.id });
  if (!asset) throw new ApiError("NOT_FOUND");
  headers.set("content-length", String(asset.size));
  return new Response(Readable.toWeb(asset.stream) as ReadableStream, { headers });
}
