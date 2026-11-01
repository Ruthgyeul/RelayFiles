import "server-only";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE } from "@/config/policy";
import { compareTrees, type TreeEntry } from "@/domain/fsck";
import { db } from "../db/client";
import { accountIdsOnVolume, findAccountPlacement, setAccountMigrating } from "../repositories/account.repo";
import { findRootFolder } from "../repositories/node.repo";
import { treeEntries } from "../repositories/node-tree.repo";
import { findVolume, setVolumeLayout, setVolumeStatus } from "../repositories/volume.repo";
import { ASSET_DIRS, DIR_MODE, layoutOf } from "../storage/layout";
import { LAYOUT_MIGRATIONS, layoutPlan, type LayoutMigration } from "../storage/layout-migrations";
import { availableAboveReserve, driverFor, type VolumeRecord } from "../storage/registry";
import { userRootOf } from "../storage/safe-path";
import { copyTree, hashTree, treeDifferences } from "../storage/tree";
import { readVolumeMarker, writeVolumeMarker } from "../storage/volume";
import { endMaintenanceHold, finishAccountMove, startAccountMove, startMaintenanceHold, volumeForNewAccount } from "./volume.service";

type Log = (message: string) => void;
const exists = (path: string) => stat(path).then(() => true, () => false);

/** Files of an account's folder that differ from `hashed` now: added, removed or resized since it was hashed. */
async function changedSince(hashed: ReadonlyMap<string, { size: number }>, volume: VolumeRecord, accountId: string): Promise<string[]> {
  const now = await driverFor(volume).listTree(accountId);
  const problems: string[] = [];
  for (const [path, entry] of now) if (entry.type !== "folder" && hashed.get(path)?.size !== Number(entry.size)) problems.push(`changed: ${path}`);
  for (const path of hashed.keys()) if (now.get(path)?.type !== "file") problems.push(`removed: ${path}`);
  return problems;
}

/**
 * Items the database lists for an account that are not in its folder on `volume`. Files flagged
 * missing are not expected (npm run storage:fsck -- --fix flags them). A size that differs is not
 * counted: the copy matches the original byte for byte, and fsck reports it either way.
 */
async function rowsMissingFrom(volume: VolumeRecord, accountId: string): Promise<string[]> {
  const root = await findRootFolder(db(), accountId);
  if (!root) return ["the account was deleted"];
  const rows = (await treeEntries(db(), root.id)).filter((row) => !(row.type === "FILE" && row.missing));
  const expected = new Map<string, TreeEntry>(rows.map((row) => [row.path, { type: row.type === "FILE" ? "file" : "folder", size: row.type === "FILE" ? row.size : 0n }]));
  return compareTrees(expected, await driverFor(volume).listTree(accountId)).missing.map((path) => `not copied: ${path}`);
}

/**
 * Brings a volume's directory layout to this release's version (npm run storage:migrate).
 * The volume is READONLY meanwhile (downloads keep working, changes wait), from when the writes
 * already running on it have finished; every step is written to system/migration.journal and
 * the marker records the last finished version, so an interrupted run continues where it stopped
 * when started again. At the end the volume returns to the status it had before the first run.
 */
export async function migrateVolumeLayout(volumeId: string, log: Log = () => undefined, migrations: readonly LayoutMigration[] = LAYOUT_MIGRATIONS, target: number = STORAGE.layoutVersion): Promise<{ from: number; to: number }> {
  const volume = await findVolume(db(), volumeId);
  if (!volume) throw new Error(`Volume ${volumeId} is not registered.`);
  const marker = await readVolumeMarker(volume.mountPath);
  if (!marker || marker.volumeId !== volumeId) throw new Error(`Volume ${volumeId} is not mounted at ${volume.mountPath}.`);
  // The status before the first run: kept in resumeStatus while the volume is held READONLY, so a
  // run after an interruption restores it too. A volume an admin made READONLY stays READONLY.
  const resume = volume.resumeStatus ?? volume.status;
  const plan = layoutPlan(marker.layoutVersion, target, migrations);
  if (plan.length === 0) {
    // A hold left by a run that stopped after its last step (or an interrupted storage:fsck --fix) ends here.
    if (volume.resumeStatus) await endMaintenanceHold(volumeId, volume.resumeStatus);
    log(`${volumeId}: layout ${marker.layoutVersion} is up to date.`);
    return { from: marker.layoutVersion, to: marker.layoutVersion };
  }

  const journal = join(layoutOf(volume.mountPath).system, "migration.journal");
  const record = (entry: object) => appendFile(journal, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  // Waits for the writes already running on the volume; every later one sees READONLY.
  await startMaintenanceHold(volumeId, resume);
  let current = marker.layoutVersion;
  for (const step of plan) {
    log(`${volumeId}: layout ${step.from} → ${step.to}: ${step.description}`);
    await record({ step: `${step.from}->${step.to}`, state: "started" });
    await step.up(volume.mountPath);
    await writeVolumeMarker(volume.mountPath, { ...marker, layoutVersion: step.to });
    await record({ step: `${step.from}->${step.to}`, state: "done" });
    current = step.to;
  }
  // Back to service only when every step finished; a failure leaves the volume READONLY.
  await setVolumeLayout(db(), volumeId, current, resume);
  return { from: marker.layoutVersion, to: current };
}

export interface MoveReport {
  accountId: string;
  from: string;
  to: string;
  files: number;
  bytes: number;
}

/**
 * Moves one account's files to another volume (npm run volume:migrate): wait for the account's
 * running writes and mark it as migrating (changes are refused, reads keep working) → copy →
 * compare every file's SHA-256 → check the original and the database rows against the copy once
 * more → switch the account in one update → move the old copy to the source trash,
 * where it stays for STORAGE.trashRetentionHours before it is purged.
 * Share links, tokens and node ids do not change.
 */
export async function moveAccountToVolume(accountId: string, targetVolumeId: string, log: Log = () => undefined): Promise<MoveReport | null> {
  const account = await findAccountPlacement(db(), accountId);
  if (!account) throw new Error(`Account ${accountId} not found.`);
  if (account.volumeId === targetVolumeId) return null;
  const [source, target] = await Promise.all([findVolume(db(), account.volumeId), findVolume(db(), targetVolumeId)]);
  if (!source || !target) throw new Error("Both volumes must be registered.");
  if (target.status !== "ACTIVE") throw new Error(`Target volume ${target.id} is ${target.status}, not ACTIVE.`);
  for (const volume of [source, target]) {
    const marker = await readVolumeMarker(volume.mountPath);
    if (marker?.volumeId !== volume.id) throw new Error(`Volume ${volume.id} is not mounted at ${volume.mountPath}.`);
  }

  const from = userRootOf(source.mountPath, accountId);
  const to = userRootOf(target.mountPath, accountId);
  // Changes stop before the original is hashed, so the copy is compared with a fixed tree: this
  // waits for the account's running storage transactions, and every later one sees `migrating`.
  await startAccountMove(accountId);
  let files: Awaited<ReturnType<typeof hashTree>>;
  let bytes: number;
  try {
    files = await hashTree(from);
    bytes = [...files.values()].reduce((sum, file) => sum + file.size, 0);
    const space = await driverFor(target).space();
    if (availableAboveReserve(space.total, space.available, target.reservePct) < BigInt(bytes)) throw new Error(`Not enough free space on ${target.id} for ${bytes} bytes.`);
    // A copy left behind by an earlier failed attempt is not referenced by anything.
    await rm(to, { recursive: true, force: true });
    log(`${accountId}: copying ${files.size} files (${bytes} bytes) ${source.id} → ${target.id}`);
    await copyTree(from, to);
    for (const dir of Object.values(ASSET_DIRS)) {
      const assets = join(layoutOf(source.mountPath)[dir], accountId);
      const copy = join(layoutOf(target.mountPath)[dir], accountId);
      if (await exists(assets)) {
        await mkdir(layoutOf(target.mountPath)[dir], { recursive: true, mode: DIR_MODE });
        await rm(copy, { recursive: true, force: true });
        await copyTree(assets, copy);
      }
    }
    const problems = treeDifferences(files, await hashTree(to));
    if (problems.length > 0) throw new Error(`Copy does not match the original (${problems.length}): ${problems.slice(0, 5).join(", ")}`);
    // Last check before the switch: the original still holds what was hashed (nothing was written
    // past the lock), and every item the database lists is in the copy.
    const changed = await changedSince(files, source, accountId);
    const unlisted = await rowsMissingFrom(target, accountId);
    if (changed.length + unlisted.length > 0) {
      const found = [...changed, ...unlisted];
      throw new Error(`The copy does not match the account now (${found.length}): ${found.slice(0, 5).join(", ")}. Run the move again; npm run storage:fsck shows differences that were there before.`);
    }
    await finishAccountMove(accountId, target.id);
  } catch (error) {
    await rm(to, { recursive: true, force: true }).catch(() => undefined);
    await setAccountMigrating(db(), accountId, false);
    throw error;
  }

  const old = driverFor(source);
  const trashed = await old.moveToTrash({ accountId, segments: [] });
  await old.removeAccountAssets(accountId);
  log(`${accountId}: switched to ${target.id}; old copy in ${trashed}`);
  return { accountId, from: source.id, to: target.id, files: files.size, bytes };
}

/**
 * Empties a volume (SSD replacement): it stops receiving new accounts (DRAINING) and every
 * account on it moves to `targetVolumeId`, or to the ACTIVE volume with the most free space.
 */
export async function drainVolume(sourceVolumeId: string, targetVolumeId: string | null, log: Log = () => undefined): Promise<MoveReport[]> {
  await setVolumeStatus(db(), sourceVolumeId, "DRAINING");
  const accounts = await accountIdsOnVolume(db(), sourceVolumeId);
  const reports: MoveReport[] = [];
  for (const id of accounts) {
    const target = targetVolumeId ?? (await volumeForNewAccount()).volumeId;
    const report = await moveAccountToVolume(id, target, log);
    if (report) reports.push(report);
  }
  log(`${sourceVolumeId}: ${reports.length} account(s) moved; the daily job purges its trash after STORAGE.trashRetentionHours, then remove the volume.`);
  return reports;
}
