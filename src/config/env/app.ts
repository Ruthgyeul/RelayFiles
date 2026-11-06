/** Environment group schemas: the app itself (URL, theme, security headers) and the test runners. Assembled in src/config/env.ts. */
import { z } from "zod";
import { HEADERS } from "../policy";
import { DEFAULT_THEME, THEME_KEYS } from "../theme";
import { bool, cidrList, port } from "./fields";

export const appEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_HOST: z.string().default("127.0.0.1"),
  APP_PORT: port.default(3000),
  PUBLIC_URL: z.url().default("http://localhost:3000"),
  DEFAULT_THEME: z.enum(THEME_KEYS).default(DEFAULT_THEME),
  SERVER_LOCATION: z.string().default("Seoul, KR"),
  ENABLE_UI_CATALOG: bool.default(false),
  ADMIN_ALLOWED_CIDRS: cidrList.default([]),
  /**
   * Secret Nginx sends in X-Relay-Proxy (both templates). When set, the app believes the
   * visitor address headers only on requests that carry it (domain/network.ts clientIp).
   */
  PROXY_SHARED_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, "must be 32-128 letters, digits, - or _ (run npm run env:secrets)").optional(),
  /** "enforce" blocks what the policy does not allow; "report-only" only logs it (to /api/csp-report). */
  CSP_MODE: z.enum(["report-only", "enforce"]).default("enforce"),
  /** Strict-Transport-Security max-age when PUBLIC_URL is https (0 = do not send it, e.g. Cloudflare already does). */
  HSTS_MAX_AGE_SEC: z.coerce.number().int().min(0).default(HEADERS.hstsMaxAgeSec),
  /** Adds includeSubDomains; only when every subdomain of PUBLIC_URL's domain is https. */
  HSTS_INCLUDE_SUBDOMAINS: bool.default(false),
});

export const testingEnv = z.object({
  E2E_PORT: port.default(3100),
  E2E_BASE_URL: z.url().optional(),
  PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),
});
