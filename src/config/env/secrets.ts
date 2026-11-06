/** Environment group schemas: keys for account tokens and cookies. Assembled in src/config/env.ts. */
import { z } from "zod";
import { base64Key32, secret } from "./fields";

export const secretsEnv = z
  .object({
    TOKEN_ENC_KEY: base64Key32,
    TOKEN_HMAC_KEY: secret(32),
    COOKIE_SECRET: secret(32),
    TOKEN_ENC_KEY_PREVIOUS: base64Key32.optional(),
    TOKEN_HMAC_KEY_PREVIOUS: secret(32).optional(),
    COOKIE_SECRET_PREVIOUS: secret(32).optional(),
  })
  .superRefine((env, ctx) => {
    // A *_PREVIOUS key equal to the current one is a rotation that did not happen: values made
    // with the real old key would stop working, and nothing warns until users are locked out.
    for (const key of ["TOKEN_ENC_KEY", "TOKEN_HMAC_KEY", "COOKIE_SECRET"] as const) {
      if (env[`${key}_PREVIOUS`] === env[key]) ctx.addIssue({ code: "custom", path: [`${key}_PREVIOUS`], message: `must differ from ${key} (set it to the old key while rotating, or leave it empty)` });
    }
  });
