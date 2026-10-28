import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseUrlOf, getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import { db } from "../db/client";
import { backupRow } from "../metrics/services";
import type { FsckReport } from "./fsck.service";

// The shared test volume holds other tests' leftovers, so storage:fsck is stubbed per test.
const fsck = vi.hoisted(() => ({ report: { accounts: [], strayAccounts: [] } as FsckReport }));
vi.mock("./fsck.service", () => ({ runFsck: async () => fsck.report }));

const { verifyBackup } = await import("./backup-check.service");

afterAll(() => db().$disconnect());

beforeEach(() => {
  fsck.report = { accounts: [], strayAccounts: [] };
});

// The test database stands in for the scratch copy: same schema, same counts.
const restoredUrl = () => databaseUrlOf(getEnv("database"));
const dump = (ageMs: number) => ({ name: "relayfiles-test.dump", at: new Date(Date.now() - ageMs) });

describe("backup verification", () => {
  it("passes a fresh dump with the current schema and matching storage, and shows it on the Server page", async () => {
    const check = await verifyBackup({ dump: dump(MS.hour), restoredUrl: restoredUrl(), restoreMs: 12_000 });
    expect(check).toMatchObject({ ok: true, problems: [], fsckDifferences: 0, dumpName: "relayfiles-test.dump", restoreMs: 12_000 });
    const row = await backupRow(new Date());
    expect(row.status).toBe("healthy");
    expect(row.detail).toContain("restored in 0:12");
  });

  it("fails an old dump, storage differences and a restore the shell could not finish", async () => {
    fsck.report = { accounts: [{ accountId: "a", volumeId: "v", missing: ["x"], orphans: ["y", "z"], sizeMismatch: [], flagged: 0, trashed: 0, notMoved: [] }], strayAccounts: [] };
    const old = await verifyBackup({ dump: dump(30 * MS.hour), restoredUrl: restoredUrl(), restoreMs: 1_000 });
    expect(old.ok).toBe(false);
    expect(old.fsckDifferences).toBe(3);
    expect(old.problems).toEqual(["newest dump is 30 h old (limit 26 h)", "storage check found 3 differences (npm run storage:fsck)"]);

    const failed = await verifyBackup({ dump: dump(MS.hour), restoredUrl: null, restoreMs: null, failure: "pg_restore failed" });
    expect(failed).toMatchObject({ ok: false, problems: ["pg_restore failed"], fsckDifferences: null });
    const row = await backupRow(new Date());
    expect(row.status).toBe("failing");
    expect(row.detail).toContain("pg_restore failed");
  });

  it("fails when the scratch database cannot be read", async () => {
    const url = new URL(restoredUrl());
    url.pathname = "/relayfiles_no_such_database";
    const check = await verifyBackup({ dump: dump(MS.hour), restoredUrl: url.toString(), restoreMs: 1_000 });
    expect(check).toMatchObject({ ok: false, problems: ["the restored dump cannot be read"] });
  });
});
