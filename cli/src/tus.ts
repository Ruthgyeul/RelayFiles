import { open } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, type Client } from "./client.ts";

/** tus 1.0 metadata: comma-separated "key base64(value)" pairs. */
export function encodeMetadata(metadata: Readonly<Record<string, string>>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
    .join(",");
}

/** The next chunk to send: from `offset`, at most `chunkSize` bytes, never past the end. */
export function nextChunk(offset: number, size: number, chunkSize: number): { start: number; length: number } {
  return { start: offset, length: Math.max(0, Math.min(chunkSize, size - offset)) };
}

/** Waits before retry `attempt` (1, 2, …): 1 s, 2 s, 4 s … at most 30 s. */
export function retryDelayMs(attempt: number): number {
  const BASE_MS = 1_000;
  const MAX_MS = 30_000;
  return Math.min(BASE_MS * 2 ** (attempt - 1), MAX_MS);
}

const TUS = { "tus-resumable": "1.0.0" };
const RETRIES = 5;

export interface TusFile {
  path: string;
  size: number;
  name: string;
  lastModified: number;
}

/**
 * Sends one file of a planned batch (POST /api/v1/uploads) with tus: create, then PATCH chunks.
 * A chunk that fails is retried after asking the server where it stopped (HEAD); the server
 * only lets the token that planned the batch continue. Answers the server's final JSON.
 */
export async function tusUpload(client: Client, endpoint: string, batchId: string, index: number, file: TusFile, chunkSize: number, onProgress: (sent: number) => void): Promise<unknown> {
  const metadata = encodeMetadata({ batch: batchId, index: String(index), filename: file.name, lastModified: String(file.lastModified) });
  const created = await client.raw("POST", endpoint, { headers: { ...TUS, "upload-length": String(file.size), "upload-metadata": metadata } });
  if (created.status !== 201) throw new ApiError((await created.text()).trim() || `HTTP ${created.status}`, created.status, null);
  const location = created.headers.get("location");
  if (!location) throw new ApiError("The server did not say where to send the file.", created.status, null);

  const handle = await open(file.path, "r");
  try {
    let offset = 0;
    let attempt = 0;
    for (;;) {
      const { start, length } = nextChunk(offset, file.size, chunkSize);
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, start);
      // The file shrank or was rewritten while uploading: never send the zero-filled rest as data.
      if (bytesRead !== length) throw new Error(`${file.path} changed while it was uploading. Upload it again.`);
      const res = await client
        .raw("PATCH", location, { headers: { ...TUS, "upload-offset": String(start), "content-type": "application/offset+octet-stream" }, body: bytes })
        .catch((error: unknown) => error as Error);
      if (res instanceof Response && (res.status === 204 || res.status === 200)) {
        attempt = 0;
        offset = start + length;
        onProgress(offset);
        // The last chunk is answered with the placed file (200 and JSON).
        if (offset >= file.size) return res.status === 200 ? await res.json() : null;
        continue;
      }
      // 4xx other than a conflict on the offset will not get better by retrying.
      if (res instanceof Response && res.status !== 409 && res.status < 500) throw new ApiError((await res.text()).trim() || `HTTP ${res.status}`, res.status, null);
      if (++attempt > RETRIES) throw res instanceof Response ? new ApiError(`HTTP ${res.status}`, res.status, null) : res;
      await sleep(retryDelayMs(attempt));
      const head = await client.raw("HEAD", location, { headers: TUS }).catch(() => null);
      const known = Number(head?.headers.get("upload-offset"));
      if (head?.ok && Number.isSafeInteger(known)) offset = known;
    }
  } finally {
    await handle.close();
  }
}
