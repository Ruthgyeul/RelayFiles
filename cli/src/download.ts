import { createWriteStream } from "node:fs";
import { rename, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApiError, readJson, type Client } from "./client.ts";

/**
 * "a.txt" from `attachment; filename*=UTF-8''a.txt` or `filename="a.txt"`, else null. Only a
 * plain file name is taken: the name comes from the server (or anything between it and the
 * client), so a name with a folder part ("../.bashrc") would write outside the current folder.
 */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  let name: string | null;
  if (star?.[1]) {
    try {
      name = decodeURIComponent(star[1]);
    } catch {
      return null;
    }
  } else name = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
  return name !== null && plainFileName(name) ? name : null;
}

/** A name that stays in the current folder: no separators, not "." or "..", no NUL. */
function plainFileName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
}

/** The Range header to continue a partial download of `have` bytes (none for an empty start). */
export function resumeRange(have: number): string | null {
  return have > 0 ? `bytes=${have}-` : null;
}

const PARTIAL = ".part";

/**
 * Downloads a file to `target` (a path, or the server's file name in the current folder).
 * Bytes go to "<target>.part" first; an interrupted download continues from where it stopped
 * (Range, checked against the ETag), and the file is renamed into place once complete.
 */
export async function downloadFile(client: Client, id: string, target: string | null, onStart: (name: string, total: number) => void): Promise<string> {
  const head = await client.raw("HEAD", `/api/v1/files/${encodeURIComponent(id)}`);
  if (!head.ok) await readJson(await client.raw("GET", `/api/v1/files/${encodeURIComponent(id)}`, { headers: { range: "bytes=0-0" } }));
  const name = target ?? fileNameOf(head.headers.get("content-disposition")) ?? id;
  const total = Number(head.headers.get("content-length"));
  const etag = head.headers.get("etag");
  const partial = `${name}${PARTIAL}`;
  const have = await stat(partial).then(
    (info) => info.size,
    () => 0,
  );
  const range = have < total ? resumeRange(have) : null;

  onStart(name, total);
  const res = await client.raw("GET", `/api/v1/files/${encodeURIComponent(id)}`, { headers: { ...(range ? { range } : {}), ...(range && etag ? { "if-range": etag } : {}) } });
  if (!res.ok || !res.body) throw new ApiError(`HTTP ${res.status}`, res.status, null);
  // 206: the rest of the same file; 200: the file changed (or no Range), start over.
  const append = res.status === 206;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(partial, { flags: append ? "a" : "w" }));
  await rename(partial, name);
  return name;
}
