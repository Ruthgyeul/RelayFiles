#!/usr/bin/env node
/**
 * Fails when pictographic emoji appear in source or deploy files.
 * Icons must be SVG components (see docs/plan.md §3.2). Typographic symbols used by
 * the design (© ® ™ · … → ← ↑ ↓ ⌘ ∞ •) are not pictographic and stay allowed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOTS = ["src", "deploy", "scripts", "e2e"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".conf", ".sh", ".yml", ".yaml"]);
/** Generated third-party output (not committed) is skipped. */
const SKIP_DIRS = new Set(["node_modules", "generated"]);
const ALLOWED = new Set(["©", "®", "™"]);
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\u{FE0F}]/gu;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(name))) yield path;
  }
}

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(PICTOGRAPHIC)) {
          if (!ALLOWED.has(match[0])) findings.push(`${relative(".", file)}:${index + 1}  U+${match[0].codePointAt(0).toString(16).toUpperCase()}`);
        }
      });
  }
}

if (findings.length > 0) {
  console.error(`Emoji are not allowed (use SVG icons instead):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("check:emoji passed");
