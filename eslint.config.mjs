import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { readFileSync } from "node:fs";
import boundaries from "eslint-plugin-boundaries";

/** Prisma model delegates (`db.account`, `tx.node`), read from the schema so new models are covered. */
const PRISMA_MODELS = [...readFileSync(new URL("prisma/schema.prisma", import.meta.url), "utf8").matchAll(/^model (\w+)/gm)].map(([, name]) => name[0].toLowerCase() + name.slice(1));
/** Prisma Client model operations. */
const PRISMA_OPERATIONS = ["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany", "count", "aggregate", "groupBy"];

/**
 * Architectural layers (see docs/architecture.md).
 * Each layer may only import from the layers listed in its policy below.
 */
const ELEMENTS = [
  { type: "app", pattern: "src/app" },
  { type: "feature", pattern: "src/features/*", capture: ["feature"] },
  { type: "shared", pattern: "src/shared" },
  { type: "domain", pattern: "src/domain" },
  { type: "contracts", pattern: "src/contracts" },
  { type: "config", pattern: "src/config" },
  { type: "server", pattern: "src/server" },
];

const allowTo = (...types) => ({ to: { element: { types: { anyOf: types } } } });

const LAYER_POLICIES = [
  { from: { element: { type: "app" } }, allow: allowTo("app", "feature", "shared", "domain", "contracts", "config", "server") },
  { from: { element: { type: "feature" } }, allow: allowTo("feature", "shared", "domain", "contracts", "config") },
  { from: { element: { type: "shared" } }, allow: allowTo("shared", "domain", "contracts", "config") },
  { from: { element: { type: "server" } }, allow: allowTo("server", "domain", "contracts", "config") },
  { from: { element: { type: "contracts" } }, allow: allowTo("contracts", "domain", "config") },
  { from: { element: { type: "domain" } }, allow: allowTo("domain", "config") },
  { from: { element: { type: "config" } }, allow: allowTo("config") },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": ELEMENTS,
      "import/resolver": { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            // npm packages and Node built-ins are governed by code review, not by layer rules.
            { allow: { to: { module: { origin: "external" } } } },
            { allow: { to: { module: { origin: "core" } } } },
            ...LAYER_POLICIES,
          ],
        },
      ],
      // File-level cycles; scripts/check-feature-cycles.mjs checks the features as a whole.
      "import/no-cycle": ["error", { ignoreExternal: true }],
    },
  },
  {
    // Browser code also runs on plain-http LAN addresses, where secure-context APIs are missing.
    files: ["src/features/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "crypto", property: "randomUUID", message: "Not available over plain http (secure contexts only); use a counter or useId()." },
      ],
    },
  },
  {
    // Queries live in src/server/repositories. Elsewhere db() is only passed to repositories or
    // opens a transaction ($transaction, $disconnect, $queryRaw for the health check).
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.{mjs,mts,ts}"],
    ignores: ["src/server/repositories/**", "src/server/db/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.type='CallExpression'][object.callee.name='db'][property.name=/^[a-z]/]",
          message: "Query the database through a function in src/server/repositories.",
        },
        {
          // The same through a DbClient or transaction passed in (`db.account.findMany`, `tx.node.update`).
          selector: `MemberExpression[object.type='MemberExpression'][object.property.name=/^(${PRISMA_MODELS.join("|")})$/][property.name=/^(${PRISMA_OPERATIONS.join("|")})$/]`,
          message: "Query the database through a function in src/server/repositories.",
        },
      ],
    },
  },
  {
    // Route handlers and pages reach the database only through services.
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/db/*", "@/server/repositories/*"], message: "Call a service in src/server/services instead." },
          ],
        },
      ],
    },
  },
  {
    // Node scripts and tooling configs may log to the console.
    files: ["scripts/**/*.{mjs,mts,ts}", "*.config.{mjs,mts,ts}"],
    rules: { "no-console": "off" },
  },
  globalIgnores(["cli/**", "src/server/db/generated/**", ".next/**", ".app/**", "out/**", "build/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
]);

export default eslintConfig;
