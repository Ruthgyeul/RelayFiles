import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";
import { databaseUrlOf, parseEnvGroup } from "./src/config/env";

// Load .env / .env.local exactly like Next.js does, so the CLI and the app share one config.
loadEnvConfig(process.cwd());

/** The URL is only needed for migrate/introspect; `prisma generate` works without credentials. */
function datasourceUrl(): string | undefined {
  try {
    return databaseUrlOf(parseEnvGroup("database", process.env));
  } catch {
    return undefined;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: datasourceUrl() },
});
