import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    // `server-only` throws outside React Server Components; tests import server modules directly.
    "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
  },
};

/**
 * - unit: pure logic and components, no external services (`npm test`).
 * - integration: needs PostgreSQL and Redis from `.env` (`npm run test:integration`).
 */
export default defineConfig({
  resolve,
  test: {
    restoreMocks: true,
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        resolve,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts", "scripts/**/*.int.test.ts"],
          setupFiles: ["./test/integration-setup.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
