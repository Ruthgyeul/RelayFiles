import "server-only";
import { createHash } from "node:crypto";

/** SHA-256 (hex) of a byte stream, read chunk by chunk (files of any size). */
export async function sha256Of(source: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of source) hash.update(chunk);
  return hash.digest("hex");
}
