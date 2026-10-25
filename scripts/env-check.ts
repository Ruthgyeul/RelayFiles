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
// Admin sessions are long-lived and the admin token opens every account: in production, admin
// pages should only answer from trusted networks.
if ((production || process.env.NODE_ENV === "production") && !process.env.ADMIN_ALLOWED_CIDRS?.trim()) {
  console.warn("\nWarning: ADMIN_ALLOWED_CIDRS is empty, so admin pages and APIs answer from any address. Set it to your LAN or VPN range (e.g. 192.168.0.0/24).");
}
console.log("\nenv:check passed");
