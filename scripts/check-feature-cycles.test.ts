import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function check(files: Record<string, string>): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "features-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  try {
    return { ok: true, output: execFileSync("node", ["scripts/check-feature-cycles.mjs", dir], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { ok: false, output: String((error as { stderr?: string }).stderr) };
  }
}

describe("feature cycle check", () => {
  it("accepts one-way imports and imports inside a feature", () => {
    const result = check({
      "files/List.tsx": 'import { useShell } from "@/features/shell/ShellProvider";\nimport { Row } from "@/features/files/Row";',
      "shell/ShellProvider.tsx": 'import { api } from "@/features/account/api";',
      "account/api.ts": "export const api = {};",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects features that import each other through different files, naming the files", () => {
    const result = check({
      "files/List.tsx": 'import { hasFiles } from "@/features/transfers/read-drop";',
      "transfers/Panel.tsx": 'import { folderHref } from "@/features/files/paths";',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("files (files/List.tsx) → transfers (transfers/Panel.tsx) → files");
  });

  it("finds longer cycles and ignores tests", () => {
    expect(
      check({
        "a/x.ts": 'import { b } from "@/features/b/x";',
        "b/x.ts": 'import { c } from "@/features/c/x";',
        "c/x.ts": 'import { a } from "@/features/a/x";',
      }).ok,
    ).toBe(false);
    expect(check({ "a/x.ts": 'import { b } from "@/features/b/x";', "b/x.test.ts": 'import { a } from "@/features/a/x";' }).ok).toBe(true);
  });
});
