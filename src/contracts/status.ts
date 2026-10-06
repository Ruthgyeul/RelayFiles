import { z } from "zod";
import { INCIDENT_SEVERITIES, type ComponentKey, type DayLevel, type IncidentSeverity } from "@/domain/status";

/** "2026-10-05": a calendar day in the server's JOBS_TIMEZONE. */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface IncidentDto {
  id: string;
  title: string;
  text: string;
  severity: IncidentSeverity;
  /** Calendar day the incident happened (YYYY-MM-DD). */
  date: string;
  duration: string;
  resolved: boolean;
}

export const MAX_INCIDENT_TITLE = 120;
export const MAX_INCIDENT_TEXT = 2_000;
export const MAX_INCIDENT_DURATION = 40;

/** Post / edit incident body (design incident dialog). */
export const incidentInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(MAX_INCIDENT_TITLE),
  text: z.string().trim().max(MAX_INCIDENT_TEXT),
  severity: z.enum(INCIDENT_SEVERITIES),
  date: z.string().regex(DAY_PATTERN),
  duration: z.string().trim().max(MAX_INCIDENT_DURATION),
  resolved: z.boolean(),
});
export type IncidentInput = z.infer<typeof incidentInputSchema>;

/** One hour of server probe latency. No data: `avgMs` null and not failed. */
export interface LatencyHourDto {
  hour: string;
  avgMs: number | null;
  /** Probes ran in this hour and none succeeded. */
  failed: boolean;
}

export interface StatusComponentDto {
  key: ComponentKey;
  name: string;
  detail: string;
  /** Latest recent probe result; null when the worker hasn't probed lately. */
  latestOk: boolean | null;
  /** Percent over the strip's days; null without data. */
  uptime: number | null;
  days: { day: string; level: DayLevel }[];
}

/** GET /api/status (public). Browser checks are measured by the page itself. */
export interface StatusData {
  latency: LatencyHourDto[];
  components: StatusComponentDto[];
  server: {
    location: string;
    p50: number | null;
    p95: number | null;
    tls: { state: "valid" | "expired"; expiresAt: string } | { state: "none" | "unreadable" };
    /** Website uptime over the last STATUS.uptimeDays days. */
    uptime: number | null;
  };
  incidents: IncidentDto[];
}
