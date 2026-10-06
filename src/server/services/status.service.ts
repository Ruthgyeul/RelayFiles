import "server-only";
import { getAppEnv, getEnv } from "@/config/env";
import { MS, STATUS } from "@/config/policy";
import type { IncidentDto, IncidentInput, LatencyHourDto, StatusComponentDto, StatusData } from "@/contracts/status";
import { formatSize } from "@/domain/format";
import { newNodeId } from "@/domain/ids";
import { COMPONENTS, dayKeyIn, dayKeysEndingWith, dayLevel, uptimePercent, type IncidentSeverity } from "@/domain/status";
import { cached, cacheKey, invalidate } from "../cache/cached";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { dailySince, hourlyFor, latestSamples, responsePercentiles } from "../repositories/health.repo";
import { createIncident, deleteIncident, recentIncidents, updateIncident, type IncidentRow } from "../repositories/incident.repo";
import { storageCapacity } from "../metrics/storage";
import { certificateState } from "../metrics/tls";

const toDay = (date: Date) => date.toISOString().slice(0, 10);

function toIncidentDto(row: IncidentRow): IncidentDto {
  return { id: row.id, title: row.title, text: row.text, severity: row.severity.toLowerCase() as IncidentSeverity, date: toDay(row.date), duration: row.duration, resolved: row.resolved };
}

/** The last STATUS.latencyHours hours of website probe latency, oldest first. */
async function latencyHours(now: Date): Promise<LatencyHourDto[]> {
  const currentHour = Math.floor(now.getTime() / MS.hour) * MS.hour;
  const first = currentHour - (STATUS.latencyHours - 1) * MS.hour;
  const rows = new Map((await hourlyFor(db(), "website", new Date(first))).map((row) => [row.hour.getTime(), row]));
  return Array.from({ length: STATUS.latencyHours }, (_, i) => {
    const hour = first + i * MS.hour;
    const row = rows.get(hour);
    const failed = !!row && row.okCount === 0 && row.failCount > 0;
    return { hour: new Date(hour).toISOString(), avgMs: failed ? null : (row?.avgMs ?? null), failed };
  });
}

async function components(now: Date, today: string): Promise<{ list: StatusComponentDto[]; uptime: number | null }> {
  const uptimeDays = dayKeysEndingWith(today, STATUS.uptimeDays);
  const stripDays = uptimeDays.slice(-STATUS.serviceDays);
  const fresh = new Date(now.getTime() - STATUS.freshProbes * getEnv("jobs").HEALTH_PROBE_INTERVAL_SEC * MS.second);
  const [daily, latest, capacity] = await Promise.all([dailySince(db(), uptimeDays[0]!), latestSamples(db(), fresh), storageCapacity()]);
  const counts = new Map(daily.map((row) => [`${row.component}:${toDay(row.day)}`, row]));
  const sum = (key: string, days: readonly string[]) =>
    days.reduce(
      (total, day) => {
        const row = counts.get(`${key}:${day}`);
        return { ok: total.ok + (row?.okCount ?? 0), fail: total.fail + (row?.failCount ?? 0) };
      },
      { ok: 0, fail: 0 },
    );

  const list = COMPONENTS.map(({ key, name, detail }) => {
    const strip = sum(key, stripDays);
    return {
      key,
      name,
      detail: key === "storage" && capacity ? `${formatSize(capacity.totalBytes)} volume` : detail,
      latestOk: latest.get(key) ?? null,
      uptime: uptimePercent(strip.ok, strip.fail),
      days: stripDays.map((day) => {
        const row = counts.get(`${key}:${day}`);
        return { day, level: dayLevel(row?.okCount ?? 0, row?.failCount ?? 0) };
      }),
    };
  });
  const website = sum("website", uptimeDays);
  return { list, uptime: uptimePercent(website.ok, website.fail) };
}

async function loadStatus(now: Date): Promise<StatusData> {
  const today = dayKeyIn(now, getEnv("jobs").JOBS_TIMEZONE);
  const [latency, comps, response, tls, incidents] = await Promise.all([
    latencyHours(now),
    components(now, today),
    responsePercentiles(db(), "website", new Date(now.getTime() - STATUS.responseWindowHours * MS.hour)),
    certificateState(now),
    recentIncidents(db(), STATUS.incidentsShown),
  ]);
  return {
    latency,
    components: comps.list,
    server: { location: getAppEnv().SERVER_LOCATION, ...response, tls, uptime: comps.uptime },
    incidents: incidents.map(toIncidentDto),
  };
}

/** Everything the public Status page shows besides this browser's own checks. */
export function statusData(now: Date = new Date()): Promise<StatusData> {
  return cached(cacheKey.status(), STATUS.cacheSec, () => loadStatus(now));
}

const toRow = (input: IncidentInput) => ({
  title: input.title,
  text: input.text,
  severity: input.severity.toUpperCase() as "MINOR" | "MAJOR" | "MAINT",
  date: new Date(`${input.date}T00:00:00Z`),
  duration: input.duration,
  resolved: input.resolved,
});

export async function postIncident(input: IncidentInput): Promise<{ id: string }> {
  const id = newNodeId();
  await createIncident(db(), id, toRow(input));
  await invalidate([cacheKey.status()]);
  return { id };
}

export async function editIncident(id: string, input: IncidentInput): Promise<void> {
  if (!(await updateIncident(db(), id, toRow(input)))) throw new ApiError("NOT_FOUND");
  await invalidate([cacheKey.status()]);
}

export async function removeIncident(id: string): Promise<void> {
  if (!(await deleteIncident(db(), id))) throw new ApiError("NOT_FOUND");
  await invalidate([cacheKey.status()]);
}
