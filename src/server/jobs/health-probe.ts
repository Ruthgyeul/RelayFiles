import "server-only";
import { z } from "zod";
import { getAppEnv, getEnv } from "@/config/env";
import { MS, STATUS } from "@/config/policy";
import { healthSchema } from "@/contracts/health";
import { COMPONENTS, componentChecks, dayKeyIn, dayLevel, type ProbeResult } from "@/domain/status";
import { invalidate, cacheKey } from "../cache/cached";
import { db } from "../db/client";
import { insertSamples, pruneHealth, rollUpDays, rollUpHours } from "../repositories/health.repo";
import { storageWritable } from "../metrics/storage";

/** What one probe measured: the component results and the app's response time. */
export interface ProbeOutcome {
  probe: ProbeResult;
  ms: number | null;
}

const envelope = z.object({ data: healthSchema });

/** The app's health endpoint as the worker reaches it. */
export function probeUrl(): string {
  const base = getEnv("jobs").HEALTH_PROBE_URL ?? `http://127.0.0.1:${getAppEnv().APP_PORT}`;
  return new URL("/api/health", base).toString();
}

/** Calls the running app's health endpoint and checks the upload staging area. */
export async function probeApp(url: string = probeUrl()): Promise<ProbeOutcome> {
  const writable = storageWritable().catch(() => false);
  const started = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(STATUS.probeTimeoutMs) });
    const ms = Math.round(performance.now() - started);
    const { components } = envelope.parse(await res.json()).data;
    const up = (status: string) => status === "ok";
    return { probe: { reachable: true, database: up(components.database), redis: up(components.redis), storage: up(components.storage), writable: await writable }, ms };
  } catch {
    return { probe: { reachable: false, database: false, redis: false, storage: false, writable: await writable }, ms: null };
  }
}

const LEVEL = { ok: "OK", warn: "WARN", down: "DOWN" } as const;

/**
 * Records one probe for every Status page component, then refreshes the hourly and daily
 * rollups it touched and drops samples past their retention.
 */
export async function recordProbe(outcome: ProbeOutcome, now: Date): Promise<void> {
  const checks = componentChecks(outcome.probe);
  await insertSamples(
    db(),
    now,
    COMPONENTS.map(({ key }) => ({ component: key, ok: checks[key], ms: key === "website" && checks.website ? outcome.ms : null })),
  );
  const hourStart = Math.floor(now.getTime() / MS.hour) * MS.hour;
  await rollUpHours(db(), new Date(hourStart - MS.hour));
  const timeZone = getEnv("jobs").JOBS_TIMEZONE;
  // Yesterday is re-counted too, so a probe just after midnight completes it.
  const yesterday = dayKeyIn(new Date(now.getTime() - MS.day), timeZone);
  await rollUpDays(db(), timeZone, yesterday, new Date(now.getTime() - 2 * MS.day - MS.hour), (ok, fail) => {
    const level = dayLevel(ok, fail);
    return level === "nodata" ? "OK" : LEVEL[level];
  });
  await pruneHealth(db(), new Date(now.getTime() - STATUS.sampleRetentionHours * MS.hour), new Date(now.getTime() - STATUS.hourlyRetentionDays * MS.day));
  await invalidate([cacheKey.status()]);
}

export async function runHealthProbe(now: Date = new Date()): Promise<ProbeOutcome> {
  const outcome = await probeApp();
  await recordProbe(outcome, now);
  return outcome;
}
