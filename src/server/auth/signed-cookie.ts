import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { z } from "zod";

/**
 * Signed cookie values: base64url JSON, a dot, and an HMAC-SHA256 of the payload. `purpose`
 * is mixed into the signature so a value signed for one cookie is never accepted by another.
 * The session cookie predates purposes and signs with none (an empty one), which keeps
 * existing devices signed in.
 */
export const sign = (payload: string, secret: string, purpose: string) => createHmac("sha256", secret).update(`${purpose}${payload}`).digest("base64url");

export function encodeSigned(value: unknown, secret: string, purpose: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload, secret, purpose)}`;
}

/** The parsed value, or null when it is missing, signed with none of `secrets`, or malformed. */
export function decodeSigned<T>(raw: string | undefined, schema: z.ZodType<T>, secrets: readonly string[], purpose: string): T | null {
  if (!raw) return null;
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const given = Buffer.from(signature);
  const valid = secrets.some((secret) => {
    const expected = Buffer.from(sign(payload, secret, purpose));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
