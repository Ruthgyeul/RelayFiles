import "server-only";
import os from "node:os";
import si from "systeminformation";
import { METRICS, MS } from "@/config/policy";

/**
 * Host measurements. In a container these describe the container unless /proc and /sys
 * of the host are mounted (docs/deploy-ubuntu.md).
 */
export async function cpuMemory() {
  const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  return {
    cpu: { percent: Math.round(load.currentLoad), cores: os.availableParallelism(), load: Number(os.loadavg()[0]!.toFixed(2)) },
    // "available" counts reclaimable cache as free, like `free -h`.
    memory: { usedBytes: mem.total - mem.available, totalBytes: mem.total },
  };
}

/**
 * Network rates summed over non-loopback interfaces. systeminformation measures the rate
 * since its previous call in this process, so the first call reports 0.
 */
export async function networkRates() {
  const stats = await si.networkStats("*");
  const external = stats.filter((stat) => stat.iface !== "lo");
  const rate = (value: number | null) => (value !== null && value > 0 ? value : 0);
  return {
    outPerSec: external.reduce((sum, stat) => sum + rate(stat.tx_sec), 0),
    inPerSec: external.reduce((sum, stat) => sum + rate(stat.rx_sec), 0),
  };
}

let linkSpeed: { value: number | null; at: number } | null = null;
const LINK_CACHE_MS = METRICS.linkCacheSec * MS.second;

/** Speed of the default interface in Mbps (cached; it rarely changes). */
export async function linkMbps(): Promise<number | null> {
  if (linkSpeed && Date.now() - linkSpeed.at < LINK_CACHE_MS) return linkSpeed.value;
  try {
    const iface = await si.networkInterfaces("default");
    const speed = Array.isArray(iface) ? iface[0]?.speed : iface.speed;
    linkSpeed = { value: speed && speed > 0 ? speed : null, at: Date.now() };
  } catch {
    linkSpeed = { value: null, at: Date.now() };
  }
  return linkSpeed.value;
}

export const uptimeSeconds = () => Math.floor(os.uptime());
