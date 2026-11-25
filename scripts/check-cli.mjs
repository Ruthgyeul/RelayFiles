#!/usr/bin/env node
/**
 * The CI "CLI" job, locally: the CLI's API types (cli/src/openapi.ts) are generated from
 * docs/openapi.json and must be committed with any API change, then the CLI typechecks and
 * its tests pass. Needs the CLI's own dependencies (npm --prefix cli ci). Usage: npm run check:cli
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("cli/node_modules")) {
  console.error("cli/node_modules is missing: run `npm --prefix cli ci` once, then npm run check:cli");
  process.exit(1);
}

const run = (command, args) => execFileSync(command, args, { cwd: "cli", stdio: "inherit" });
try {
  run("npm", ["run", "-s", "generate"]);
  // The types written just now must be the committed ones.
  run("git", ["diff", "--exit-code", "--", "src/openapi.ts"]);
  run("npm", ["run", "-s", "typecheck"]);
  run("npm", ["test"]);
} catch {
  console.error("check:cli failed (if src/openapi.ts changed above: commit the regenerated cli/src/openapi.ts)");
  process.exit(1);
}
console.log("check:cli passed");
