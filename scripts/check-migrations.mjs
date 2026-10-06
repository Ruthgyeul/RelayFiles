#!/usr/bin/env node
/**
 * Guards destructive SQL migrations (docs/plan.md §13.8 ①, CLAUDE.md "DB · 마이그레이션").
 * Dropping or retyping data must be the "contract" step of expand → migrate → contract, so
 * such a migration has to say so with a `-- relayfiles: contract` comment explaining which
 * earlier release stopped using the data. Anything else destructive fails the check.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "prisma/migrations";
const DESTRUCTIVE = [/\bDROP\s+(TABLE|COLUMN|INDEX|TYPE|SCHEMA)\b/i, /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bRENAME\s+(TO|COLUMN)\b/i];
const CONTRACT = /^--\s*relayfiles:\s*contract\b.+/m;

const problems = [];
for (const name of readdirSync(DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
  const sql = readFileSync(join(DIR, name, "migration.sql"), "utf8");
  const hits = DESTRUCTIVE.filter((pattern) => pattern.test(sql));
  if (hits.length > 0 && !CONTRACT.test(sql)) problems.push(`${name}: destructive SQL (${hits.map((h) => h.source).join(", ")}) without a "-- relayfiles: contract <reason>" comment`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error("Split the change into expand → migrate → contract releases (docs/runbook.md).");
  process.exit(1);
}
console.log("check:migrations passed");
