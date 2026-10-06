import "server-only";
import { Readable } from "node:stream";
import { getEnv } from "@/config/env";
import { canShowInline, contentDisposition, parseRange } from "@/domain/serving";
import type { StorageDriver, StorageLocation } from "../storage/driver";

export interface SendFileOptions {
  driver: StorageDriver;
  location: StorageLocation;
  name: string;
  mime: string;
  size: number;
  /** Strong validator (the file's SHA-256) for caching and resumed downloads. */
  etag: string | null;
  /** "stream" shows media inline; everything else (and any non-media type) is an attachment. */
  mode: "download" | "stream";
  /** Called with the number of bytes this response will send. */
  onServe?: (bytes: number) => void;
}

/**
 * Sends a stored file with Range support (206) for seeking and resumed downloads. In
 * production Nginx serves the bytes (`X-Accel-Redirect`, sendfile) after the app has
 * checked access; without Nginx the app streams the file itself.
 */
export async function sendFile(req: Request, options: SendFileOptions): Promise<Response> {
  const { driver, location, name, mime, size, etag, mode } = options;
  const inline = mode === "stream" && canShowInline(mime);
  const headers = new Headers({
    "content-type": inline ? mime : mime === "text/html" || mime === "image/svg+xml" ? "application/octet-stream" : mime,
    "content-disposition": contentDisposition(inline ? "inline" : "attachment", name),
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
  });
  if (etag) {
    headers.set("etag", `"${etag}"`);
    if (req.headers.get("if-none-match") === `"${etag}"`) return new Response(null, { status: 304, headers });
  }

  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const bytes = range ? range.end - range.start + 1 : size;

  const storage = getEnv("storage");
  if (storage.STORAGE_ACCEL_ENABLED) {
    // Nginx applies the same Range header itself; the app only reports what will be sent.
    const path = [driver.volumeId, location.accountId, ...location.segments].map(encodeURIComponent).join("/");
    headers.set("x-accel-redirect", `${storage.STORAGE_ACCEL_PREFIX}${path}`);
    options.onServe?.(bytes);
    return new Response(null, { status: 200, headers });
  }

  headers.set("content-length", String(bytes));
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  options.onServe?.(bytes);
  if (req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const stream = await driver.createReadStream(location, range ?? undefined);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
}
