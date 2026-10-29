import "server-only";
import { redis } from "../redis";

/**
 * Totals that only grow (Prometheus counters), kept in Redis so every app process adds to the
 * same number. Losing Redis data resets them, which Prometheus reads as a counter reset.
 */
export type CounterName = "transcodes_started" | "deduplicated_files";
const keyOf = (name: CounterName) => `metrics:counter:${name}`;

/** Adds one. Never fails the request it is called from. */
export async function countOne(name: CounterName): Promise<void> {
  await redis()
    .incr(keyOf(name))
    .catch(() => undefined);
}

export async function counterValue(name: CounterName): Promise<number> {
  return Number((await redis().get(keyOf(name))) ?? 0);
}
