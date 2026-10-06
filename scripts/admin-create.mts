/**
 * Creates an admin account and prints its token once: npm run admin:create
 * Admins never expire and have no storage quota. The token is not stored in plain text,
 * so save it now (it can be revealed later from the profile while signed in).
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { createAdminAccount } = await import("../src/server/services/auth.service");
const { db } = await import("../src/server/db/client");
const { redis } = await import("../src/server/redis");

try {
  const { account, token } = await createAdminAccount();
  console.log("Admin account created. Save this token now; it is the only way to sign in.\n");
  console.log(`  name   ${account.name}`);
  console.log(`  id     ${account.id}`);
  console.log(`  token  ${token}\n`);
} finally {
  await db().$disconnect();
  redis().disconnect();
}
