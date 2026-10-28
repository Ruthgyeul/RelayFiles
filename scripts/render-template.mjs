#!/usr/bin/env node
/**
 * Renders a deploy template (systemd unit, Nginx site) to stdout:
 *
 *   node scripts/render-template.mjs <template> KEY [KEY ...]
 *
 * Only ${KEY} for the listed keys is replaced, so Nginx variables ($host, $1, ...) stay as
 * they are. Values come from the environment first, then the repository's .env (with
 * ${VAR} expansion). An unlisted ${UPPER_CASE} reference or an empty value is an error, so
 * a typo can never produce a half-rendered config.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [templatePath, ...keys] = process.argv.slice(2);

if (!templatePath || keys.length === 0) {
  console.error("usage: node scripts/render-template.mjs <template> KEY [KEY ...]");
  process.exit(2);
}

nextEnv.loadEnvConfig(ROOT, false, { info: () => {}, error: console.error });

const missing = keys.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Set these in .env before rendering ${templatePath}: ${missing.join(", ")}`);
  process.exit(1);
}

/**
 * Characters that could end a value early in an Nginx or systemd file (a new line, ";", braces,
 * quotes, "$" or "\") and so add directives of their own. Hosts, ports, paths and sizes never need them.
 */
const UNSAFE_VALUE = /[\u0000-\u001f\u007f;{}"'`$\\]/;
const unsafe = keys.filter((key) => UNSAFE_VALUE.test(process.env[key]));
if (unsafe.length > 0) {
  console.error(`These .env values contain characters not allowed in ${templatePath} (new lines, ; { } quotes $ \\): ${unsafe.join(", ")}`);
  process.exit(1);
}

const rendered = readFileSync(templatePath, "utf8").replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (match, key) => {
  if (!keys.includes(key)) {
    console.error(`${templatePath} uses \${${key}}, which was not listed`);
    process.exit(1);
  }
  return process.env[key];
});
process.stdout.write(rendered);
