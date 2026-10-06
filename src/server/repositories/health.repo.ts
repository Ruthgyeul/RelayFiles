import "server-only";
import type { DbClient } from "../db/client";

/** One probe result per component (Status page history). */
export interface SampleInput {
  component: string;
  ok: boolean;
  ms: number | null;
}

export async function insertSamples(db: DbClient, at: Date, samples: readonly SampleInput[]): Promise<void> {
  await db.healthSample.createMany({ data: samples.map((sample) => ({ ...sample, at })) });
}

interface HourRow {
  component: string;
  hour: Date;
  ok: bigint;
  fail: bigint;
  avg: number | null;
  p95: number | null;
}

/** Recomputes the hourly rollups of whole hours from `since` (an hour start) on. */
export async function rollUpHours(db: DbClient, since: Date): Promise<void> {
  const rows = await db.$queryRaw<HourRow[]>`
    SELECT component, date_trunc('hour', at) AS hour,
           count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS fail,
           round(avg(ms) FILTER (WHERE ok))::float8 AS avg,
           round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) FILTER (WHERE ok AND ms IS NOT NULL))::float8 AS p95
    FROM "HealthSample" WHERE at >= ${since}
    GROUP BY component, date_trunc('hour', at)`;
  for (const row of rows) {
    const data = { okCount: Number(row.ok), failCount: Number(row.fail), avgMs: row.avg, p95Ms: row.p95 };
    await db.healthHourly.upsert({ where: { component_hour: { component: row.component, hour: row.hour } }, create: { component: row.component, hour: row.hour, ...data }, update: data });
  }
}

interface DayRow {
  component: string;
  day: string;
  ok: bigint;
  fail: bigint;
}

/**
 * Recomputes the daily rollups for calendar days (in `timeZone`) from `firstDay` on. Samples
 * are kept longer than two days, so yesterday and today are always complete.
 */
export async function rollUpDays(db: DbClient, timeZone: string, firstDay: string, since: Date, levelOf: (ok: number, fail: number) => "OK" | "WARN" | "DOWN"): Promise<void> {
  const rows = await db.$queryRaw<DayRow[]>`
    SELECT component, to_char((at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS fail
    FROM "HealthSample"
    WHERE at >= ${since} AND ((at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})::date >= ${firstDay}::date
    GROUP BY 1, 2`;
  for (const row of rows) {
    const day = new Date(`${row.day}T00:00:00Z`);
    const data = { okCount: Number(row.ok), failCount: Number(row.fail), level: levelOf(Number(row.ok), Number(row.fail)) };
    await db.healthDaily.upsert({ where: { component_day: { component: row.component, day } }, create: { component: row.component, day, ...data }, update: data });
  }
}

/** Drops raw samples and hourly rollups past their retention (daily rollups stay). */
export async function pruneHealth(db: DbClient, samplesBefore: Date, hoursBefore: Date): Promise<void> {
  await db.healthSample.deleteMany({ where: { at: { lt: samplesBefore } } });
  await db.healthHourly.deleteMany({ where: { hour: { lt: hoursBefore } } });
}

export function hourlyFor(db: DbClient, component: string, since: Date) {
  return db.healthHourly.findMany({ where: { component, hour: { gte: since } }, orderBy: { hour: "asc" }, select: { hour: true, okCount: true, failCount: true, avgMs: true } });
}

export function dailySince(db: DbClient, firstDay: string) {
  return db.healthDaily.findMany({ where: { day: { gte: new Date(`${firstDay}T00:00:00Z`) } }, select: { component: true, day: true, okCount: true, failCount: true } });
}

/** Latest sample of each component taken after `since`. */
export async function latestSamples(db: DbClient, since: Date): Promise<Map<string, boolean>> {
  const rows = await db.$queryRaw<{ component: string; ok: boolean }[]>`
    SELECT DISTINCT ON (component) component, ok FROM "HealthSample"
    WHERE at >= ${since} ORDER BY component, at DESC`;
  return new Map(rows.map((row) => [row.component, row.ok]));
}

/** Median and 95th percentile of successful response times since `since`. */
export async function responsePercentiles(db: DbClient, component: string, since: Date): Promise<{ p50: number | null; p95: number | null }> {
  const [row] = await db.$queryRaw<{ p50: number | null; p95: number | null }[]>`
    SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms))::float8 AS p50,
           round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms))::float8 AS p95
    FROM "HealthSample" WHERE component = ${component} AND ok AND ms IS NOT NULL AND at >= ${since}`;
  return { p50: row?.p50 ?? null, p95: row?.p95 ?? null };
}
