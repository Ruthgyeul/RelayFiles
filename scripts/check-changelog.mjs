#!/usr/bin/env node
/**
 * Every released version has a section in CHANGELOG.md (docs/runbook.md "릴리스 만들기"): the
 * version in package.json must appear as a `## [x.y.z] - YYYY-MM-DD` heading. With `--tag vX.Y.Z`
 * (the Images workflow on a version tag) the tag must also name that same version, so an image
 * is never published under a version the code does not carry.
 *
 * Usage: node scripts/check-changelog.mjs [--tag <tag>] [<package.json> <CHANGELOG.md>]
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const tagAt = args.indexOf("--tag");
const tag = tagAt === -1 ? null : (args[tagAt + 1] ?? "");
const [packagePath = "package.json", changelogPath = "CHANGELOG.md"] = tagAt === -1 ? args : args.filter((_, index) => index !== tagAt && index !== tagAt + 1);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
if (typeof version !== "string" || version === "") fail(`${packagePath} has no version`);

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
if (!heading.test(readFileSync(changelogPath, "utf8"))) {
  fail(`${changelogPath} has no "## [${version}] - YYYY-MM-DD" section for the version in ${packagePath}. Move the "Unreleased" entries under it.`);
}

if (tag !== null && tag !== `v${version}`) fail(`Tag "${tag}" does not match the version in ${packagePath} (expected "v${version}").`);

console.log("check:changelog passed");
