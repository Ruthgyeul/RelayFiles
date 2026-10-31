import "server-only";
import { getAppEnv, getEnv } from "@/config/env";
import { METRICS, MS } from "@/config/policy";
import type { ServiceRow } from "@/contracts/server-metrics";
import { formatAgo, formatClock, formatSize } from "@/domain/format";
import { cronLabel } from "@/domain/server";
import { db } from "../db/client";
import { CommandError, runCommand } from "../process/run-command";
import { latestBackupCheck } from "../repositories/backup-check.repo";
import { listActiveVolumes } from "../repositories/volume.repo";
import { checkVolume } from "../storage/volume";
import { lastCleanup, workerAlive } from "./history";

/** SMART health of DISK_DEVICE via `smartctl -j` (needs read access to the device). */
async function diskHealth(): Promise<ServiceRow> {
  const device = getEnv("observability").DISK_DEVICE;
  try {
    // Not logged: in a container without the disk, "unavailable" is the normal answer.
    const { stdout } = await runCommand("smartctl", ["-j", "-H", "-A", "-i", device], { timeoutMs: METRICS.smartTimeoutSec * MS.second, logFailures: false });
    return parseSmart(stdout.toString(), device);
  } catch (error) {
    // smartctl exits non-zero for warnings but still prints JSON.
    const stdout = error instanceof CommandError && error.reason === "exit" ? error.result.stdout.toString() : "";
    if (stdout) return parseSmart(stdout, device);
    return { name: "Disk health", detail: `SMART data unavailable for ${device} (install smartmontools and allow access)`, status: "unknown" };
  }
}

export function parseSmart(json: string, device: string): ServiceRow {
  try {
    const data = JSON.parse(json) as { smart_status?: { passed?: boolean }; temperature?: { current?: number }; user_capacity?: { bytes?: number }; model_name?: string };
    if (data.smart_status?.passed === undefined) throw new Error("no SMART status");
    const parts = [data.smart_status.passed ? "SMART OK" : "SMART FAILING"];
    if (data.temperature?.current !== undefined) parts.push(`${data.temperature.current}°C`);
    if (data.user_capacity?.bytes) parts.push(`${formatSize(data.user_capacity.bytes)}${data.model_name ? ` ${data.model_name}` : ""}`);
    return { name: "Disk health", detail: parts.join(" · "), status: data.smart_status.passed ? "healthy" : "failing" };
  } catch {
    return { name: "Disk health", detail: `SMART data unavailable for ${device}`, status: "unknown" };
  }
}

/** The last backup verification (deploy/scripts/verify-backup.sh), or a hint to set it up. */
export async function backupRow(now: Date): Promise<ServiceRow> {
  const check = await latestBackupCheck(db());
  if (!check) return { name: "Backup check", detail: "never run (deploy/scripts/verify-backup.sh, weekly cron)", status: "unknown" };
  const when = `checked ${formatAgo(check.checkedAt.getTime(), now.getTime())}`;
  if (!check.ok) return { name: "Backup check", detail: [when, ...check.problems].join(" · "), status: "failing" };
  const parts = [when];
  if (check.dumpAt) parts.push(`dump from ${formatAgo(check.dumpAt.getTime(), now.getTime())}`);
  if (check.restoreMs !== null) parts.push(`restored in ${formatClock(check.restoreMs / MS.second)}`);
  parts.push("storage matches the database");
  return { name: "Backup check", detail: parts.join(" · "), status: "healthy" };
}

/** The Services card, measured, never assumed. */
export async function serviceRows(now: Date): Promise<ServiceRow[]> {
  const volumes = await listActiveVolumes(db());
  const states = await Promise.all(volumes.map((volume) => checkVolume(volume.mountPath, volume.id)));
  const offline = states.filter((state) => state.state !== "online").length;
  const [alive, cleanup, disk, backup] = await Promise.all([workerAlive(), lastCleanup(), diskHealth(), backupRow(now)]);
  const jobs = getEnv("jobs");

  const cleanupDetail = [cronLabel(jobs.CLEANUP_CRON)];
  if (cleanup) cleanupDetail.push(`last run ${formatAgo(Date.parse(cleanup.at), now.getTime())}`, `removed ${cleanup.accounts} accounts, ${cleanup.items} files`);
  else cleanupDetail.push("not run yet");
  if (!alive) cleanupDetail.push("worker not running (npm run worker)");

  return [
    { name: "Web server", detail: `Node.js ${process.version} · ${getAppEnv().PUBLIC_URL.replace(/^https?:\/\//, "")}`, status: "running" },
    {
      name: "Media streaming",
      detail: offline === 0 ? `HTTP range requests · ${jobs.VIDEO_TRANSCODE_MAX > 0 ? "live conversion for unplayable formats" : "no transcoding"}` : `${offline} storage volume${offline === 1 ? "" : "s"} offline`,
      status: volumes.length > 0 && offline === 0 ? "running" : "offline",
    },
    { name: "Cleanup job", detail: cleanupDetail.join(" · "), status: alive ? "scheduled" : "stopped" },
    disk,
    backup,
  ];
}
