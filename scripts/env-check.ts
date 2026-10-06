/**
 * Validates the environment exactly as the app would load it (.env, .env.local, .env.<mode>),
 * without starting the server. Usage: npm run env:check [-- --production]
 */
import { loadEnvConfig } from "@next/env";
import { checkAllEnv, ENV_KEYS } from "../src/config/env";

const production = process.argv.includes("--production");
const { loadedEnvFiles } = loadEnvConfig(process.cwd(), !production);

console.log(`Mode: ${production ? "production" : "development"}`);
console.log(`Loaded: ${loadedEnvFiles.length ? loadedEnvFiles.map((f) => f.path).join(", ") : "(no .env files found; copy .env.example to .env)"}`);

const unknown = Object.keys(process.env).filter(
  (key) => /^(APP_|POSTGRES_|REDIS_|STORAGE_|UPLOAD_|TOKEN_|COOKIE_|ACCOUNT_|LOGIN_|JOBS_|LOG_|E2E_)/.test(key) && !ENV_KEYS.includes(key),
);
if (unknown.length) console.warn(`Unknown keys (typo?): ${unknown.join(", ")}`);

const issues = checkAllEnv(process.env);
if (issues.length) {
  console.error(`\n${issues.length} problem(s):\n- ${issues.join("\n- ")}`);
  process.exit(1);
}
console.log("\nenv:check passed");
