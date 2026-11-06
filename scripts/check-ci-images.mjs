#!/usr/bin/env node
/**
 * Fails when CI's PostgreSQL and Redis images differ from the ones docker compose runs in
 * production (deploy/docker-compose.yml): CI must test against the same pinned images, and a
 * Dependabot bump of the compose file must be carried to CI. Usage: npm run check:ci-images
 */
import { readFileSync } from "node:fs";

const compose = readFileSync("deploy/docker-compose.yml", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
let failed = false;
for (const name of ["postgres", "redis"]) {
  const pinned = new RegExp(`image: (${name}:[^\\s@]+@sha256:[0-9a-f]{64})`).exec(compose)?.[1];
  if (!pinned) {
    console.error(`deploy/docker-compose.yml has no digest-pinned ${name} image`);
    failed = true;
    continue;
  }
  const used = [...ci.matchAll(new RegExp(`\\b(${name}:[^\\s"']+)`, "g"))].map((match) => match[1]);
  if (used.length === 0) console.error(`.github/workflows/ci.yml uses no ${name} image`);
  for (const ref of used.filter((ref) => ref !== pinned)) console.error(`.github/workflows/ci.yml uses ${ref}, compose pins ${pinned}`);
  if (used.length === 0 || used.some((ref) => ref !== pinned)) failed = true;
}
if (failed) process.exit(1);
console.log("CI images match docker compose");
