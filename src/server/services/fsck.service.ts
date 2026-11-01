import "server-only";
import { compareTrees, type FsckFindings, type TreeEntry } from "@/domain/fsck";
import { db } from "../db/client";
import { accountIdsOnVolume, allAccountIds } from "../repositories/account.repo";
import { findRootFolder, setMissing } from "../repositories/node.repo";
import { treeEntries } from "../repositories/node-tree.repo";
import { listVolumesIn } from "../repositories/volume.repo";
import { driverFor } from "../storage/registry";
import { endMaintenanceHold, startMaintenanceHold } from "./volume.service";

/**
 * npm run storage:fsck: compares each account's database tree with its folder on the volume.
 * Storage transactions roll back the disk when the database fails, but an undo that itself
 * fails leaves something behind (docs/security.md); this finds it. Without `fix` nothing is
 * changed. With `fix`, files and folders only on disk go to the volume's trash (removed for
 * good after STORAGE.trashRetentionHours, so they can still be restored), files missing on
 * disk are flagged `missing` (and unflagged when they are back). Database rows are never deleted.
 * `fix` holds each volume READONLY while it runs (see assertFixable).
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

type CheckedVolume = Awaited<ReturnType<typeof listVolumesIn>>[number];

/**
 * `fix` changes a volume only while it is READONLY: a storage transaction still running would
 * look like files only on disk (an upload placed, its row not committed yet) and be trashed, or
 * like rows without files. So the volume is held READONLY for the run (startMaintenanceHold waits
 * for the writes already running; changes are refused with STORAGE_BUSY until it ends) and put
 * back afterwards. A volume another maintenance run holds is refused before anything changes.
 */
function assertFixable(volumes: readonly CheckedVolume[]): void {
  const held = volumes.find((volume) => volume.resumeStatus !== null);
  if (!held) return;
  throw new Error(
    `Volume ${held.id} is held READONLY by another maintenance run (npm run storage:migrate or storage:fsck --fix) and returns to ${held.resumeStatus} when it ends. ` +
      "storage:fsck --fix changes nothing until then; if no such run is active any more, npm run storage:migrate ends the hold.",
  );
}

export async function runFsck(options: { fix: boolean; accountId?: string }): Promise<FsckReport> {
  const report: FsckReport = { accounts: [], strayAccounts: [] };
  const volumes = await listVolumesIn(db(), CHECKED);
  if (options.fix) assertFixable(volumes);
  for (const volume of volumes) {
    const accounts = await accountIdsOnVolume(db(), volume.id, { settled: true, onlyId: options.accountId });
    if (accounts.length === 0 && options.accountId) continue;
    const fix = options.fix;
    if (fix) await startMaintenanceHold(volume.id, volume.status);
    try {
      await checkVolume(volume, accounts, { fix, all: !options.accountId }, report);
    } finally {
      if (fix) await endMaintenanceHold(volume.id, volume.status);
    }
  }
  return report;
}

/** Compares (and with `fix` repairs) the accounts of one volume, then looks for folders of unknown accounts (`all`). */
async function checkVolume(volume: CheckedVolume, accounts: readonly string[], { fix, all }: { fix: boolean; all: boolean }, report: FsckReport): Promise<void> {
  const driver = driverFor(volume);
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
  if (!all) return;
  const known = await allAccountIds(db());
  for (const accountId of await driver.listAccountRoots()) {
    if (known.has(accountId)) continue;
    if (fix) await driver.moveToTrash({ accountId, segments: [] });
    report.strayAccounts.push({ volumeId: volume.id, accountId, trashed: fix });
  }
}
