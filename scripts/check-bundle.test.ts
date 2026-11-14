import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A build with one route whose first load is `chunks` (name → content), checked against `budget`. */
function check(chunks: Record<string, string>, budget: { maxRouteKb: number; lazyOnly: Record<string, string> }): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  const next = join(dir, ".next");
  mkdirSync(join(next, "static", "chunks"), { recursive: true });
  mkdirSync(join(next, "diagnostics"));
  for (const [name, content] of Object.entries(chunks)) writeFileSync(join(next, "static", "chunks", name), content);
  writeFileSync(join(next, "diagnostics", "route-bundle-stats.json"), JSON.stringify([{ route: "/files", firstLoadChunkPaths: Object.keys(chunks).map((name) => `.next/static/chunks/${name}`) }]));
  writeFileSync(join(dir, "budget.json"), JSON.stringify(budget));
  try {
    return { ok: true, output: execFileSync("node", ["scripts/check-bundle.mjs", next, join(dir, "budget.json")], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { ok: false, output: String((error as { stderr?: string }).stderr) };
  }
}

/** Text that gzip hardly shrinks (random), so its size counts. */
const noise = (bytes: number) => randomBytes(bytes).toString("base64");

describe("bundle budget", () => {
  it("passes a first load within the budget without lazy-only libraries", () => {
    expect(check({ "a.js": "small()" }, { maxRouteKb: 10, lazyOnly: { "tus-js-client": "Upload-Offset" } }).ok).toBe(true);
  });

  it("fails a route whose first load is over the budget", () => {
    const result = check({ "a.js": noise(40 * 1024) }, { maxRouteKb: 10, lazyOnly: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("/files");
  });

  it("fails when a lazy-only library is part of the first load", () => {
    const result = check({ "a.js": 'headers["Upload-Offset"]=0' }, { maxRouteKb: 10, lazyOnly: { "tus-js-client": "Upload-Offset" } });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("tus-js-client");
  });
});
