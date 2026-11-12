/**
 * Validates the environment exactly as the app would load it (.env, .env.local, .env.<mode>),
 * without starting the server. Usage: npm run env:check [-- --production]
 */
import nextEnv from "@next/env";
import { checkAllEnv, ENV_KEYS } from "../src/config/env";

const production = process.argv.includes("--production");
const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), !production);

console.log(`Mode: ${production ? "production" : "development"}`);
console.log(`Loaded: ${loadedEnvFiles.length ? loadedEnvFiles.map((f) => f.path).join(", ") : "(no .env files found; copy .env.example to .env)"}`);

const unknown = Object.keys(process.env).filter(
  (key) => /^(APP_|POSTGRES_|REDIS_|STORAGE_|UPLOAD_|TOKEN_|COOKIE_|ACCOUNT_|LOGIN_|JOBS_|LOG_|E2E_|NGINX_|OFFSITE_|RESTIC_|K3S_|NOTIFY_|CSP_|HSTS_|CLOUDFLARE)/.test(key) && !ENV_KEYS.includes(key),
);
if (unknown.length) console.warn(`Unknown keys (typo?): ${unknown.join(", ")}`);

const issues = checkAllEnv(process.env);
if (issues.length) {
  console.error(`\n${issues.length} problem(s):\n- ${issues.join("\n- ")}`);
  process.exit(1);
}
const isProduction = production || process.env.NODE_ENV === "production";
// Admin sessions are long-lived and the admin token opens every account: in production, admin
// pages should only answer from trusted networks.
if (isProduction && !process.env.ADMIN_ALLOWED_CIDRS?.trim()) {
  console.warn("\nWarning: ADMIN_ALLOWED_CIDRS is empty, so admin pages and APIs answer from any address. Set it to your LAN or VPN range (e.g. 192.168.0.0/24).");
}
// report-only only logs what the policy would block: fine while checking a change, but
// production should enforce it (the default).
if (isProduction && process.env.CSP_MODE?.trim() === "report-only") {
  console.warn('\nWarning: CSP_MODE is report-only, so the Content-Security-Policy blocks nothing. Once the logs show no "csp violation" from your own pages, set CSP_MODE=enforce (docs/runbook.md "CSP 강제 적용").');
}
// Without it, a process that reaches the app port directly (another container on its network, a
// local user on a systemd host) can name any visitor address.
if (isProduction && !process.env.PROXY_SHARED_SECRET?.trim()) {
  console.warn("\nWarning: PROXY_SHARED_SECRET is empty, so the app believes X-Real-IP from anything that reaches its port. Set it (npm run env:secrets) and re-create Nginx.");
}
// Sign-in tokens and share passwords travel in requests: over plain http anyone on the way reads them.
const publicUrl = process.env.PUBLIC_URL?.trim() ?? "";
if (isProduction && /^http:\/\//.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(publicUrl)) {
  console.warn("\nWarning: PUBLIC_URL is http, so tokens, passwords and cookies cross the network unencrypted (and the session cookie is not Secure). Serve the site over https (Cloudflare Tunnel or Certbot) and set PUBLIC_URL to the https address.");
}
console.log("\nenv:check passed");
