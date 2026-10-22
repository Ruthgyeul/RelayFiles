import { contentRangeTotal } from "@/domain/serving";

const PARTIAL_CONTENT = 206;
const RANGE_NOT_SATISFIABLE = 416;

export interface FileHead {
  bytes: Uint8Array;
  /** Size of the whole file, when the server said. */
  total: number | null;
  /** More of the file follows the bytes read. */
  truncated: boolean;
}

/**
 * The first `limit` bytes of a file: one Range request, and a server that ignores the range
 * is cut off after `limit` bytes, so a preview never downloads a whole large file.
 */
export async function fetchHead(src: string, limit: number, signal: AbortSignal): Promise<FileHead> {
  const response = await fetch(src, { headers: { range: `bytes=0-${limit - 1}` }, signal });
  // An empty file has no byte 0 to start a range at.
  if (response.status === RANGE_NOT_SATISFIABLE) return { bytes: new Uint8Array(0), total: 0, truncated: false };
  if (!response.ok || !response.body) throw new Error(`Preview request failed (${response.status})`);
  const length = response.headers.get("content-length");
  const total = response.status === PARTIAL_CONTENT ? contentRangeTotal(response.headers.get("content-range")) : length === null ? null : Number(length);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let ended = false;
  while (received < limit) {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    chunks.push(value);
    received += value.length;
  }
  if (!ended) await reader.cancel().catch(() => undefined);

  const bytes = new Uint8Array(Math.min(received, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, total, truncated: total === null ? !ended || received > limit : total > bytes.length };
}
