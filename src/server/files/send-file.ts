import "server-only";
import { pipeline, Readable } from "node:stream";
import { getEnv } from "@/config/env";
import { canShowInline, contentDisposition, parseRange } from "@/domain/serving";
import type { ByteSource, StorageDriver, StorageLocation } from "../storage/driver";
import { Throttle } from "./throttle";

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
  /** Bytes to send instead of the stored file (a metadata-stripped image), read range by range. */
  body?: ByteSource;
  /** Bytes per second for a busy file. */
  rateLimit?: number;
}

/** Bytes held in memory as a {@link ByteSource} (a copy made for this request). */
export function bytesSource(bytes: Uint8Array): ByteSource {
  const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    size: all.length,
    open: async (range) => Readable.from([range ? all.subarray(range.start, range.end + 1) : all]),
  };
}

/**
 * Sends a stored file with Range support (206) for seeking and resumed downloads. In
 * production Nginx serves the bytes (`X-Accel-Redirect`, sendfile) after the app has
 * checked access; without Nginx the app streams the file itself.
 */
export async function sendFile(req: Request, options: SendFileOptions): Promise<Response> {
  const { driver, location, name, mime, etag, mode, body, rateLimit } = options;
  const size = body ? body.size : options.size;
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
  if (storage.STORAGE_ACCEL_ENABLED && !body) {
    // Nginx applies the same Range header itself; the app only reports what will be sent.
    const path = [driver.volumeId, location.accountId, ...location.segments].map(encodeURIComponent).join("/");
    headers.set("x-accel-redirect", `${storage.STORAGE_ACCEL_PREFIX}${path}`);
    if (rateLimit) headers.set("x-accel-limit-rate", String(rateLimit));
    options.onServe?.(bytes);
    return new Response(null, { status: 200, headers });
  }

  headers.set("content-length", String(bytes));
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  options.onServe?.(bytes);
  if (req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const source = body ? await body.open(range ?? undefined) : await driver.createReadStream(location, range ?? undefined);
  // pipeline (not pipe): when the client goes away and the response stream is destroyed, the
  // file is closed too instead of waiting, paused and open, for garbage collection.
  const stream = rateLimit ? pipeline(source, new Throttle(rateLimit), () => undefined) : source;
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
}
