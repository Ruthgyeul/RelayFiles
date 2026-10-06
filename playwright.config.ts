import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { parseEnvGroup } from "./src/config/env";

// The app server under test reads the same .env (PostgreSQL, Redis, storage, secrets).
loadEnvConfig(process.cwd());

const testing = parseEnvGroup("testing", process.env);
const BASE_URL = testing.E2E_BASE_URL ?? `http://localhost:${testing.E2E_PORT}`;

/**
 * E2E runs against the production standalone build.
 * - E2E_BASE_URL: test an already running server instead (e.g. the Ubuntu deployment).
 * - PLAYWRIGHT_CHROMIUM_PATH: use a preinstalled Chromium binary.
 * The local server enables the /dev/ui catalog so primitives can be checked against the design,
 * and allows many anonymous sign-ups because every test context is a new visitor.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    launchOptions: testing.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: testing.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: testing.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start`,
        env: { PORT: String(testing.E2E_PORT), HOSTNAME: "127.0.0.1", ENABLE_UI_CATALOG: "true", SIGNUPS_PER_HOUR: "10000" },
        url: BASE_URL,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      },
});
