#!/usr/bin/env node
/**
 * Keeps what each page loads before it can run within scripts/bundle-budget.json (run after
 * `next build`; part of `npm run check`): the gzip size of every route's first-load JavaScript,
 * and heavy libraries that must only ever be loaded when used (viewers, the upload client).
 * Reads Next's own per-route list of first-load chunks (.next/diagnostics/route-bundle-stats.json).
 *
 * Usage: node scripts/check-bundle.mjs [<.next dir>] [<budget.json>]
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [nextDir = ".next", budgetPath = "scripts/bundle-budget.json"] = process.argv.slice(2);
const KB = 1024;

function fail(message) {
  console.error(message);
  process.exit(1);
}

let stats;
try {
  stats = JSON.parse(readFileSync(join(nextDir, "diagnostics", "route-bundle-stats.json"), "utf8"));
} catch {
  fail(`No ${join(nextDir, "diagnostics", "route-bundle-stats.json")}: run npm run build first.`);
}
const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
// Chunk paths in the stats are relative to the project (".next/static/chunks/…").
const root = resolve(nextDir, "..");
const files = new Map();
const chunk = (path) => {
  if (!files.has(path)) {
    const bytes = readFileSync(join(root, path));
    files.set(path, { gzip: gzipSync(bytes).length, text: bytes.toString("utf8") });
  }
  return files.get(path);
};

const problems = [];
let largest = 0;
for (const { route, firstLoadChunkPaths } of stats) {
  const kb = firstLoadChunkPaths.reduce((sum, path) => sum + chunk(path).gzip, 0) / KB;
  largest = Math.max(largest, kb);
  if (kb > budget.maxRouteKb) problems.push(`${route}: ${kb.toFixed(0)} kB of JavaScript (gzip) before it runs, over the ${budget.maxRouteKb} kB budget`);
  for (const [library, marker] of Object.entries(budget.lazyOnly)) {
    const where = firstLoadChunkPaths.find((path) => chunk(path).text.includes(marker));
    if (where) problems.push(`${route}: ${library} is part of the first load (${where}); import it where it is used (import()).`);
  }
}

if (problems.length > 0) fail(problems.join("\n"));
console.log(`check:bundle passed (${stats.length} routes, largest ${Math.round(largest)} of ${budget.maxRouteKb} kB gzip)`);
