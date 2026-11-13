import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function check(version: string, changelog: string, tag?: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "changelog-"));
  const packagePath = join(dir, "package.json");
  const changelogPath = join(dir, "CHANGELOG.md");
  writeFileSync(packagePath, JSON.stringify({ version }));
  writeFileSync(changelogPath, changelog);
  const args = ["scripts/check-changelog.mjs", ...(tag === undefined ? [] : ["--tag", tag]), packagePath, changelogPath];
  try {
    return { ok: true, output: execFileSync("node", args, { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { ok: false, output: String((error as { stderr?: string }).stderr) };
  }
}

const CHANGELOG = "# Changelog\n\n## [Unreleased]\n\n## [1.6.0] - 2026-11-20\n\n- something\n\n## [1.5.0] - 2026-10-31\n";

describe("changelog guard", () => {
  it("accepts a version that has a dated section", () => {
    expect(check("1.6.0", CHANGELOG).ok).toBe(true);
    expect(check("1.5.0", CHANGELOG).ok).toBe(true);
  });

  it("rejects a version without a section", () => {
    const result = check("1.7.0", CHANGELOG);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("[1.7.0]");
  });

  it("does not take a longer version or an undated heading for the section", () => {
    expect(check("1.6", CHANGELOG).ok).toBe(false);
    expect(check("1.6.0", "## [1.6.0]\n").ok).toBe(false);
    expect(check("1.6.0", "## [1x6x0] - 2026-11-20\n").ok).toBe(false);
  });

  it("requires a release tag to name the package version", () => {
    expect(check("1.6.0", CHANGELOG, "v1.6.0").ok).toBe(true);
    const result = check("1.6.0", CHANGELOG, "v1.5.0");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("v1.6.0");
    expect(check("1.6.0", CHANGELOG, "1.6.0").ok).toBe(false);
  });
});
