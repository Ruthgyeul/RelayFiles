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
    // `npm run test:coverage`: what the unit and integration tests together reach of the code
    // that runs on the server and the pure rules (pages and components are covered by e2e).
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/domain/**/*.ts", "src/contracts/**/*.ts", "src/config/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.int.test.ts", "src/server/db/generated/**"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      // Just under the first measurement (2026-11-14: 91.6 / 85.8 / 92.7 / 95.1 %): fails when
      // a change takes away tests or adds untested code. Raise them as coverage grows.
      thresholds: { statements: 90, branches: 84, functions: 91, lines: 94 },
    },
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
