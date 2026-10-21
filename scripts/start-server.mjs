#!/usr/bin/env node
/**
 * Starts the standalone Next.js server (npm run start, and the systemd unit).
 *
 *   node scripts/start-server.mjs [bundle-dir]     (default: .next/standalone)
 *
 * The standalone server.js only reads PORT/HOSTNAME and changes into its own directory,
 * so it would miss the repository's .env. This loads .env here (with ${VAR} expansion,
 * which systemd's EnvironmentFile does not do), maps APP_PORT/APP_HOST onto PORT/HOSTNAME
 * unless they are already set, and makes a relative STORAGE_ROOT absolute.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(ROOT, process.argv[2] ?? ".next/standalone");
const server = join(bundle, "server.js");

if (!existsSync(server)) {
  console.error(`${server} not found. Run "npm run build" first.`);
  process.exit(1);
}

nextEnv.loadEnvConfig(ROOT, false);

const env = process.env;
env.PORT ??= env.APP_PORT;
env.HOSTNAME ??= env.APP_HOST;
if (env.STORAGE_ROOT && !isAbsolute(env.STORAGE_ROOT)) env.STORAGE_ROOT = resolve(ROOT, env.STORAGE_ROOT);

await import(pathToFileURL(server).href);
