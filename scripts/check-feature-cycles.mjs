#!/usr/bin/env node
/**
 * Keeps features acyclic (docs/architecture.md): if feature A imports feature B, B must not
 * reach A through any chain of feature imports. import/no-cycle only sees file-level cycles,
 * so two features that import different files of each other pass it; this check does not.
 * Code both need belongs in src/shared, and composition of several features in src/app.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.argv[2] ?? "src/features";
const SOURCE = /\.(ts|tsx)$/;
const TEST = /\.test\.(ts|tsx)$/;
const IMPORT = /from\s+["']@\/features\/([^/"']+)\//g;

function filesOf(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesOf(path);
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });
}

/** feature → (imported feature → first file that imports it) */
const graph = new Map();
for (const feature of readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
  const edges = new Map();
  for (const file of filesOf(join(ROOT, feature))) {
    for (const [, target] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (target !== feature && !edges.has(target)) edges.set(target, relative(ROOT, file).split(sep).join("/"));
    }
  }
  graph.set(feature, edges);
}

/** Every cycle once, as the list of features it passes through (starting at its smallest name). */
function cycles() {
  const found = new Map();
  const walk = (start, node, path) => {
    for (const next of graph.get(node)?.keys() ?? []) {
      if (next === start) found.set([...path].sort().join(" "), path);
      else if (next > start && !path.includes(next)) walk(start, next, [...path, next]);
    }
  };
  for (const feature of graph.keys()) walk(feature, feature, [feature]);
  return [...found.values()];
}

const problems = cycles().map((path) => [...path, path[0]].map((feature, index, all) => (index === all.length - 1 ? feature : `${feature} (${graph.get(feature).get(all[index + 1])})`)).join(" → "));
if (problems.length > 0) {
  console.error(`Feature import cycles:\n${problems.map((line) => `  ${line}`).join("\n")}`);
  console.error("Move what both sides need to src/shared, or compose the features in src/app.");
  process.exit(1);
}
console.log("check:cycles passed");
