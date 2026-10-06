#!/usr/bin/env node
/**
 * `output: "standalone"` does not include static assets. Copy them next to the
 * standalone server so `node .next/standalone/server.js` serves a complete app
 * (the same layout the Docker image uses).
 */
import { cpSync, existsSync } from "node:fs";

const STANDALONE = ".next/standalone";

if (!existsSync(STANDALONE)) {
  console.error(`${STANDALONE} not found. Run "next build" with output: "standalone" first.`);
  process.exit(1);
}

cpSync(".next/static", `${STANDALONE}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${STANDALONE}/public`, { recursive: true });
console.log("standalone bundle prepared");
