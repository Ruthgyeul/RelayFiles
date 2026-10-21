import "server-only";
import { Readable } from "node:stream";
import { IMMUTABLE_CACHE } from "@/config/policy";
import { ApiError } from "../http/api-error";
import type { AssetKind, StorageDriver } from "../storage/driver";

/**
 * A generated WebP (thumbnail or viewer preview, re-encoded without metadata) with an ETag
 * tied to the file contents, or null when the worker has not made it. Used for the owner's
 * pages and for share pages.
 */
export async function sendAsset(
  req: Request,
  driver: StorageDriver,
  accountId: string,
  row: { id: string; sha256: string | null },
  kind: Extract<AssetKind, "thumb" | "preview">,
): Promise<Response | null> {
  const etag = `"${row.sha256 ?? row.id}-${kind}"`;
  const headers = new Headers({
    "content-type": "image/webp",
    "cache-control": IMMUTABLE_CACHE,
    "x-content-type-options": "nosniff",
    etag,
  });
  const source = await driver.assetSource({ kind, accountId, nodeId: row.id });
  if (!source) return null;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(source.size));
  if (req.method === "HEAD") return new Response(null, { headers });
  return new Response(Readable.toWeb(await source.open()) as ReadableStream, { headers });
}

/** The list thumbnail, or 404 until the worker made one. */
export async function sendThumb(req: Request, driver: StorageDriver, accountId: string, row: { id: string; sha256: string | null }): Promise<Response> {
  const response = await sendAsset(req, driver, accountId, row, "thumb");
  if (!response) throw new ApiError("NOT_FOUND");
  return response;
}
