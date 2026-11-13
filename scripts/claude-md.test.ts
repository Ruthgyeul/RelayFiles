import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Lifecycle hooks npm runs by itself: nobody types them, so the command list leaves them out. */
const LIFECYCLE_SCRIPTS = new Set(["postinstall"]);

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const claudeMd = readFileSync("CLAUDE.md", "utf8");

/** The fenced block under "## 명령어", where every npm script is listed with what it does. */
function commandBlock(): string {
  const section = claudeMd.slice(claudeMd.indexOf("## 명령어"));
  const start = section.indexOf("```bash");
  return section.slice(start, section.indexOf("```", start + 1));
}

describe("CLAUDE.md command list", () => {
  it("lists every npm script", () => {
    const block = commandBlock();
    const missing = Object.keys(packageJson.scripts).filter((name) => !LIFECYCLE_SCRIPTS.has(name) && !new RegExp(`^npm (run )?${name}(\\s|$)`, "m").test(block));
    expect(missing).toEqual([]);
  });

  it("lists no script that package.json does not have", () => {
    const listed = [...commandBlock().matchAll(/^npm run (\S+)/gm)].map((match) => match[1]);
    expect(listed.filter((name) => name !== undefined && !(name in packageJson.scripts))).toEqual([]);
  });

  it("describes every step of npm run check", () => {
    const line = commandBlock().split("\n").find((text) => text.startsWith("npm run check ")) ?? "";
    const steps = (packageJson.scripts.check ?? "").split("&&").map((step) => step.trim().replace(/^npm run /, ""));
    // "check:emoji" is described as "emoji", "typecheck" as "typecheck".
    const undescribed = steps.filter((step) => !line.includes(step.replace(/^check:/, "")));
    expect(undescribed).toEqual([]);
  });
});
