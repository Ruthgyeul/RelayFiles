import { MS } from "@/config/policy";

/** Row counts compared between the restored dump and production. */
export interface BackupCounts {
  accounts: number;
  nodes: number;
  publicLinks: number;
}

export interface BackupFacts {
  /** When the dump was written. */
  dumpAt: number;
  now: number;
  /** Newest migration applied in the restored database, and the newest one this code ships. */
  restoredMigration: string | null;
  expectedMigration: string | null;
  restored: BackupCounts;
  live: BackupCounts;
  /** Items storage:fsck found different between the database and the volumes. */
  fsckDifferences: number;
  /** What `restic check` reported about the offsite repository; null when it passed or none is set up. */
  offsiteError: string | null;
}

export interface BackupLimits {
  maxDumpAgeHours: number;
  maxDriftPct: number;
}

const COUNT_LABEL: Record<keyof BackupCounts, string> = { accounts: "accounts", nodes: "files and folders", publicLinks: "public links" };
const PERCENT = 100;

/**
 * What is wrong with a restored backup, in words for the Server page; empty when it is
 * usable. The dump may lag production by up to a day, so counts may be lower than live by
 * `maxDriftPct`, but an empty table that has rows in production always fails.
 */
export function backupProblems(facts: BackupFacts, limits: BackupLimits): string[] {
  const problems: string[] = [];
  const ageHours = (facts.now - facts.dumpAt) / MS.hour;
  if (ageHours > limits.maxDumpAgeHours) problems.push(`newest dump is ${Math.floor(ageHours)} h old (limit ${limits.maxDumpAgeHours} h)`);
  if (facts.restoredMigration !== facts.expectedMigration) {
    problems.push(`dump schema is ${facts.restoredMigration ?? "empty"}, the code expects ${facts.expectedMigration ?? "none"}`);
  }
  for (const key of Object.keys(COUNT_LABEL) as (keyof BackupCounts)[]) {
    const [restored, live] = [facts.restored[key], facts.live[key]];
    if (live > 0 && restored === 0) problems.push(`no ${COUNT_LABEL[key]} in the dump (${live} live)`);
    else if (live > 0 && ((live - restored) / live) * PERCENT > limits.maxDriftPct) problems.push(`${restored} ${COUNT_LABEL[key]} in the dump, ${live} live`);
  }
  if (facts.fsckDifferences > 0) problems.push(`storage check found ${facts.fsckDifferences} difference${facts.fsckDifferences === 1 ? "" : "s"} (npm run storage:fsck)`);
  if (facts.offsiteError) problems.push(`offsite backup: ${facts.offsiteError}`);
  return problems;
}
