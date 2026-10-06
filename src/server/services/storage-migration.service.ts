import "server-only";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE } from "@/config/policy";
import { db } from "../db/client";
import { findVolume } from "../repositories/volume.repo";
import { DIR_MODE, layoutOf } from "../storage/layout";
import { LAYOUT_MIGRATIONS, layoutPlan, type LayoutMigration } from "../storage/layout-migrations";
import { availableAboveReserve, driverFor } from "../storage/registry";
import { userRootOf } from "../storage/safe-path";
import { copyTree, hashTree, treeDifferences } from "../storage/tree";
import { readVolumeMarker, writeVolumeMarker } from "../storage/volume";
import { volumeForNewAccount } from "./volume.service";

type Log = (message: string) => void;
const exists = (path: string) => stat(path).then(() => true, () => false);

/**
 * Brings a volume's directory layout to this release's version (npm run storage:migrate).
 * The volume is READONLY meanwhile (downloads keep working, changes wait); every step is
 * written to system/migration.journal and the marker records the last finished version,
 * so an interrupted run continues where it stopped when started again.
 */
export async function migrateVolumeLayout(volumeId: string, log: Log = () => undefined, migrations: readonly LayoutMigration[] = LAYOUT_MIGRATIONS, target: number = STORAGE.layoutVersion): Promise<{ from: number; to: number }> {
  const volume = await findVolume(db(), volumeId);
  if (!volume) throw new Error(`Volume ${volumeId} is not registered.`);
  const marker = await readVolumeMarker(volume.mountPath);
  if (!marker || marker.volumeId !== volumeId) throw new Error(`Volume ${volumeId} is not mounted at ${volume.mountPath}.`);
  const plan = layoutPlan(marker.layoutVersion, target, migrations);
  if (plan.length === 0) {
    log(`${volumeId}: layout ${marker.layoutVersion} is up to date.`);
    return { from: marker.layoutVersion, to: marker.layoutVersion };
  }

  const journal = join(layoutOf(volume.mountPath).system, "migration.journal");
  const record = (entry: object) => appendFile(journal, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  await db().storageVolume.update({ where: { id: volumeId }, data: { status: "READONLY" } });
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
  await db().storageVolume.update({ where: { id: volumeId }, data: { status: volume.status === "READONLY" ? "ACTIVE" : volume.status, layoutVersion: current } });
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
 * Moves one account's files to another volume (npm run volume:migrate): mark the account
 * as migrating (changes are refused, reads keep working) → copy → compare every file's
 * SHA-256 → switch the account in one update → move the old copy to the source trash,
 * where it stays for STORAGE.trashRetentionHours before it is purged.
 * Share links, tokens and node ids do not change.
 */
export async function moveAccountToVolume(accountId: string, targetVolumeId: string, log: Log = () => undefined): Promise<MoveReport | null> {
  const account = await db().account.findUnique({ where: { id: accountId }, select: { id: true, volumeId: true, migrating: true } });
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
  // Changes stop before the original is hashed, so the copy is compared with a fixed tree.
  await db().account.update({ where: { id: accountId }, data: { migrating: true } });
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
    for (const dir of ["thumbs", "derived"] as const) {
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
    await db().account.update({ where: { id: accountId }, data: { volumeId: target.id, migrating: false } });
  } catch (error) {
    await rm(to, { recursive: true, force: true }).catch(() => undefined);
    await db().account.update({ where: { id: accountId }, data: { migrating: false } });
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
  await db().storageVolume.update({ where: { id: sourceVolumeId }, data: { status: "DRAINING" } });
  const accounts = await db().account.findMany({ where: { volumeId: sourceVolumeId }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const reports: MoveReport[] = [];
  for (const { id } of accounts) {
    const target = targetVolumeId ?? (await volumeForNewAccount()).volumeId;
    const report = await moveAccountToVolume(id, target, log);
    if (report) reports.push(report);
  }
  log(`${sourceVolumeId}: ${reports.length} account(s) moved; the volume can be removed once its trash is purged.`);
  return reports;
}
