import "server-only";
import { getEnv } from "@/config/env";
import type { TokenKeys } from "./token-crypto";

/** Token encryption and lookup keys, including the previous ones during rotation (docs/plan.md §13.8 ⑥). */
export function tokenKeys(): TokenKeys {
  const env = getEnv("secrets");
  return {
    encKey: Buffer.from(env.TOKEN_ENC_KEY, "base64"),
    hmacKey: env.TOKEN_HMAC_KEY,
    previousEncKey: env.TOKEN_ENC_KEY_PREVIOUS ? Buffer.from(env.TOKEN_ENC_KEY_PREVIOUS, "base64") : undefined,
    previousHmacKey: env.TOKEN_HMAC_KEY_PREVIOUS,
  };
}

/** Cookie signing secrets: the current one first, then the previous one during rotation. */
export function cookieSecrets(): string[] {
  const env = getEnv("secrets");
  return env.COOKIE_SECRET_PREVIOUS ? [env.COOKIE_SECRET, env.COOKIE_SECRET_PREVIOUS] : [env.COOKIE_SECRET];
}
