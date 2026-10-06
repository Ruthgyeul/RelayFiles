import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Account tokens are stored twice, neither in plain text (docs/plan.md §13.2):
 * - `tokenLookup`: HMAC-SHA256 used to find the account at sign-in.
 * - `tokenEnc`: AES-256-GCM ciphertext so the owner can reveal the full token on the profile.
 *
 * Key rotation: values written with the previous key stay readable while `*_PREVIOUS` is set.
 * Ciphertext layout: [4-byte key id][12-byte IV][16-byte auth tag][ciphertext].
 */

const KEY_ID_BYTES = 4;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface TokenKeys {
  encKey: Buffer;
  hmacKey: string;
  previousEncKey?: Buffer;
  previousHmacKey?: string;
}

/** Short fingerprint identifying which key encrypted a value. */
function keyId(key: Buffer): Buffer {
  return createHash("sha256").update(key).digest().subarray(0, KEY_ID_BYTES);
}

/** Lookup hashes for the current key and (during rotation) the previous key. */
export function tokenLookups(token: string, keys: TokenKeys): string[] {
  const hash = (key: string) => createHmac("sha256", key).update(token).digest("hex");
  return keys.previousHmacKey ? [hash(keys.hmacKey), hash(keys.previousHmacKey)] : [hash(keys.hmacKey)];
}

export function encryptToken(token: string, keys: TokenKeys): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.encKey, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([keyId(keys.encKey), iv, cipher.getAuthTag(), body]);
}

export function decryptToken(data: Uint8Array, keys: TokenKeys): string {
  const buffer = Buffer.from(data);
  const id = buffer.subarray(0, KEY_ID_BYTES);
  const key = [keys.encKey, keys.previousEncKey].find((candidate) => candidate && timingSafeEqual(keyId(candidate), id));
  if (!key) throw new Error("Token was encrypted with an unknown key.");
  const iv = buffer.subarray(KEY_ID_BYTES, KEY_ID_BYTES + IV_BYTES);
  const tag = buffer.subarray(KEY_ID_BYTES + IV_BYTES, KEY_ID_BYTES + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(KEY_ID_BYTES + IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** True when the value was encrypted with the previous key and should be re-encrypted. */
export function needsReencryption(data: Uint8Array, keys: TokenKeys): boolean {
  return !timingSafeEqual(Buffer.from(data).subarray(0, KEY_ID_BYTES), keyId(keys.encKey));
}
