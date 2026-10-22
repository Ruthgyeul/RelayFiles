import "server-only";
import { access, readFile } from "node:fs/promises";
import { MS } from "@/config/policy";
import { counterRate, parseDiskstats } from "@/domain/server";
import type { DiskRate } from "./history";

/**
 * Disk read/write of the host. /proc/diskstats is not namespaced, so a container sees the
 * host's disks too. Linux only: elsewhere no disks are reported.
 */
const DISKSTATS = "/proc/diskstats";
const SYS_BLOCK = "/sys/block";

type Counters = Map<string, { readBytes: number; writeBytes: number }>;

/** sysfs writes "/" in device names (cciss/c0d0) as "!". */
const sysPath = (name: string) => `${SYS_BLOCK}/${name.replaceAll("/", "!")}`;

/** Whole physical disks only: partitions, loop, RAM and device-mapper devices have no `device` link. */
async function physicalOnly(counters: Counters): Promise<Counters> {
  const checks = await Promise.all(
    [...counters].map(async ([name, value]) => {
      try {
        await access(`${sysPath(name)}/device`);
        return [[name, value] as const];
      } catch {
        return [];
      }
    }),
  );
  return new Map(checks.flat());
}

let previous: { at: number; counters: Counters } | null = null;

/** Read and write bytes/s of each physical disk since the previous call in this process (the first call reports none). */
export async function diskRates(now: number = Date.now()): Promise<DiskRate[]> {
  let counters: Counters;
  try {
    counters = await physicalOnly(parseDiskstats(await readFile(DISKSTATS, "utf8")));
  } catch {
    return [];
  }
  const before = previous;
  previous = { at: now, counters };
  if (!before) return [];
  const seconds = (now - before.at) / MS.second;
  return [...counters].flatMap(([name, after]) => {
    const old = before.counters.get(name);
    const readPerSec = old ? counterRate(old.readBytes, after.readBytes, seconds) : null;
    const writePerSec = old ? counterRate(old.writeBytes, after.writeBytes, seconds) : null;
    return readPerSec === null || writePerSec === null ? [] : [{ name, readPerSec, writePerSec }];
  });
}

/** The model the kernel reports for a disk ("Samsung SSD 870"), or null. */
export async function diskModel(name: string): Promise<string | null> {
  try {
    return (await readFile(`${sysPath(name)}/device/model`, "utf8")).trim() || null;
  } catch {
    return null;
  }
}
