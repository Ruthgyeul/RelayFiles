import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function check(migrations: Record<string, string>): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "migrations-"));
  for (const [name, sql] of Object.entries(migrations)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "migration.sql"), sql);
  }
  try {
    return { ok: true, output: execFileSync("node", ["scripts/check-migrations.mjs", dir], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { ok: false, output: String((error as { stderr?: string }).stderr) };
  }
}

describe("destructive migration guard", () => {
  it("accepts additive migrations", () => {
    expect(check({ "1_add": 'ALTER TABLE "Node" ADD COLUMN "x" TEXT;\nCREATE INDEX "i" ON "Node"("x");' }).ok).toBe(true);
  });

  it("rejects drops, retypes and renames without a contract note", () => {
    for (const sql of ['ALTER TABLE "Node" DROP COLUMN "x";', 'DROP TABLE "Old";', 'ALTER TABLE "Node" ALTER COLUMN "size" TYPE INTEGER;', 'ALTER TABLE "Node" RENAME COLUMN "a" TO "b";']) {
      const result = check({ "2_drop": sql });
      expect(result.ok, sql).toBe(false);
      expect(result.output).toContain("2_drop");
    }
  });

  it("accepts a contract step that says why", () => {
    expect(check({ "3_contract": '-- relayfiles: contract "x" unused since v1.4 (expand in 20261101_add_y)\nALTER TABLE "Node" DROP COLUMN "x";' }).ok).toBe(true);
  });
});
