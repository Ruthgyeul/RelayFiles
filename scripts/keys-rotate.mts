/**
 * Re-encrypts all account tokens with the current keys (npm run keys:rotate).
 * 1. Move the old values to TOKEN_ENC_KEY_PREVIOUS / TOKEN_HMAC_KEY_PREVIOUS and set new ones.
 * 2. Restart the app, then run this. 3. Remove the *_PREVIOUS values and restart again.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { db } = await import("../src/server/db/client");
const { tokenKeys } = await import("../src/server/auth/keys");
const { rotateAccountKeys } = await import("../src/server/auth/rotate-keys");

const keys = tokenKeys();
if (!keys.previousEncKey && !keys.previousHmacKey) {
  console.log("No *_PREVIOUS keys are set; tokens already use the current keys.");
} else {
  const result = await rotateAccountKeys(db(), keys, (done) => console.log(`${done} accounts checked`));
  console.log(`Done: ${result.updated} of ${result.checked} accounts updated.`);
  if (result.unreadable.length > 0) {
    console.error(`${result.unreadable.length} account(s) use a key that is neither current nor previous; keep *_PREVIOUS until resolved: ${result.unreadable.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("Remove the *_PREVIOUS keys from .env and restart.");
  }
}
await db().$disconnect();
