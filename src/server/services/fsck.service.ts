import "server-only";
import { compareTrees, type FsckFindings, type TreeEntry } from "@/domain/fsck";
import { db } from "../db/client";
import { accountIdsOnVolume, allAccountIds } from "../repositories/account.repo";
import { findRootFolder, setMissing, treeEntries } from "../repositories/node.repo";
import { listVolumesIn } from "../repositories/volume.repo";
import { driverFor } from "../storage/registry";

/**
 * npm run storage:fsck: compares each account's database tree with its folder on the volume.
 * Storage transactions roll back the disk when the database fails, but an undo that itself
 * fails leaves something behind (docs/security.md); this finds it. Without `fix` nothing is
 * changed. With `fix`, files and folders only on disk go to the volume's trash (removed for
 * good after STORAGE.trashRetentionHours, so they can still be restored), files missing on
 * disk are flagged `missing` (and unflagged when they are back). Database rows are never deleted.
 */
export interface AccountReport extends FsckFindings {
  accountId: string;
  volumeId: string;
  /** Files whose `missing` flag was changed (fix only). */
  flagged: number;
  /** Paths moved to the trash (fix only). */
  trashed: number;
  /** Orphans that could not be moved (symbolic links are refused by the driver): remove by hand. */
  notMoved: string[];
}

export interface FsckReport {
  accounts: AccountReport[];
  /** Account folders on a volume with no account in the database. */
  strayAccounts: { volumeId: string; accountId: string; trashed: boolean }[];
}

/** Volumes that hold files and are not being moved: ACTIVE and READONLY. */
const CHECKED = ["ACTIVE", "READONLY"] as const;

export async function runFsck(options: { fix: boolean; accountId?: string }): Promise<FsckReport> {
  const report: FsckReport = { accounts: [], strayAccounts: [] };
  const volumes = await listVolumesIn(db(), CHECKED);
  for (const volume of volumes) {
    const driver = driverFor(volume);
    const fix = options.fix && volume.status === "ACTIVE";
    const accounts = await accountIdsOnVolume(db(), volume.id, { settled: true, onlyId: options.accountId });
    for (const accountId of accounts) {
      const root = await findRootFolder(db(), accountId);
      if (!root) continue;
      const rows = await treeEntries(db(), root.id);
      const tree = new Map<string, TreeEntry>(rows.map((row) => [row.path, { type: row.type === "FILE" ? "file" : "folder", size: row.type === "FILE" ? row.size : 0n }]));
      const findings = compareTrees(tree, await driver.listTree(accountId));
      const entry: AccountReport = { accountId, volumeId: volume.id, ...findings, flagged: 0, trashed: 0, notMoved: [] };
      if (fix) {
        const missing = new Set(findings.missing);
        const files = rows.filter((row) => row.type === "FILE");
        const nowMissing = files.filter((row) => missing.has(row.path) && !row.missing).map((row) => row.id);
        const back = files.filter((row) => !missing.has(row.path) && row.missing).map((row) => row.id);
        await setMissing(db(), nowMissing, true);
        await setMissing(db(), back, false);
        entry.flagged = nowMissing.length + back.length;
        for (const path of findings.orphans) {
          try {
            await driver.moveToTrash({ accountId, segments: path.split("/") });
            entry.trashed++;
          } catch {
            entry.notMoved.push(path);
          }
        }
      }
      if (entry.missing.length || entry.orphans.length || entry.sizeMismatch.length || entry.flagged) report.accounts.push(entry);
    }
    if (options.accountId) continue;
    const known = await allAccountIds(db());
    for (const accountId of await driver.listAccountRoots()) {
      if (known.has(accountId)) continue;
      if (fix) await driver.moveToTrash({ accountId, segments: [] });
      report.strayAccounts.push({ volumeId: volume.id, accountId, trashed: fix });
    }
  }
  return report;
}
