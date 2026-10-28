import { describe, expect, it } from "vitest";
import { MS } from "@/config/policy";
import { backupProblems, type BackupFacts } from "./backup-check";

const now = Date.UTC(2026, 9, 28, 12);
const limits = { maxDumpAgeHours: 26, maxDriftPct: 20 };
const counts = { accounts: 10, nodes: 500, publicLinks: 20 };
const good: BackupFacts = { dumpAt: now - 3 * MS.hour, now, restoredMigration: "2_b", expectedMigration: "2_b", restored: counts, live: counts, fsckDifferences: 0, offsiteError: null };

describe("backupProblems", () => {
  it("accepts a fresh dump with the current schema and about the live counts", () => {
    expect(backupProblems(good, limits)).toEqual([]);
    // A day of new rows is fine.
    expect(backupProblems({ ...good, live: { accounts: 11, nodes: 560, publicLinks: 22 } }, limits)).toEqual([]);
    // An empty server restores an empty dump.
    const none = { accounts: 0, nodes: 0, publicLinks: 0 };
    expect(backupProblems({ ...good, restored: none, live: none }, limits)).toEqual([]);
  });

  it("names an old dump, another schema, missing rows and storage differences", () => {
    expect(backupProblems({ ...good, dumpAt: now - 30 * MS.hour }, limits)).toEqual(["newest dump is 30 h old (limit 26 h)"]);
    expect(backupProblems({ ...good, restoredMigration: "1_a" }, limits)).toEqual(["dump schema is 1_a, the code expects 2_b"]);
    expect(backupProblems({ ...good, restoredMigration: null }, limits)).toEqual(["dump schema is empty, the code expects 2_b"]);
    expect(backupProblems({ ...good, restored: { ...counts, nodes: 0 } }, limits)).toEqual(["no files and folders in the dump (500 live)"]);
    expect(backupProblems({ ...good, restored: { ...counts, accounts: 7 } }, limits)).toEqual(["7 accounts in the dump, 10 live"]);
    expect(backupProblems({ ...good, fsckDifferences: 1 }, limits)).toEqual(["storage check found 1 difference (npm run storage:fsck)"]);
    expect(backupProblems({ ...good, fsckDifferences: 3 }, limits)).toEqual(["storage check found 3 differences (npm run storage:fsck)"]);
    expect(backupProblems({ ...good, offsiteError: "restic check failed" }, limits)).toEqual(["offsite backup: restic check failed"]);
  });
});
