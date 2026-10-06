import { loadEnvConfig } from "@next/env";

// Integration tests use the same .env as the app (PostgreSQL, Redis, storage settings).
loadEnvConfig(process.cwd());
