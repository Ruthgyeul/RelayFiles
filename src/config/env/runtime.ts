/** Environment group schemas: account policy, background jobs and logs. Assembled in src/config/env.ts. */
import { z } from "zod";
import { ACCOUNT, AUTH, DUPLICATES, JOBS, LOGIN, MEDIA, RENUMBER, TRANSCODE } from "../policy";
import { positiveInt, secondsList } from "./fields";

export const policyEnv = z.object({
  ACCOUNT_TTL_DAYS: positiveInt.default(ACCOUNT.ttlDays),
  DEFAULT_QUOTA_GB: z.coerce.number().positive().default(ACCOUNT.defaultQuotaGb),
  /** Total storage all anonymous accounts may use together, in GB (unset = no total limit). */
  ANON_TOTAL_QUOTA_GB: z.coerce.number().positive().optional(),
  LOGIN_MAX_ATTEMPTS: positiveInt.default(LOGIN.maxAttempts),
  LOGIN_LOCK_SECONDS: secondsList.default([...LOGIN.lockSeconds]),
  SIGNUPS_PER_HOUR: positiveInt.default(AUTH.signupsPerHour),
  /** "Renumber files": most files one run renames. */
  RENUMBER_MAX_FILES: positiveInt.default(RENUMBER.maxFiles),
  /** "Find duplicates": most files one scan compares. */
  DUPLICATES_MAX_SCAN: positiveInt.default(DUPLICATES.maxScan),
});

export const jobsEnv = z.object({
  CLEANUP_CRON: z.string().default(JOBS.cleanupCron),
  JOBS_TIMEZONE: z.string().default(JOBS.timezone),
  METRICS_SAMPLE_INTERVAL_SEC: positiveInt.default(JOBS.metricsSampleIntervalSec),
  HEALTH_PROBE_INTERVAL_SEC: positiveInt.default(JOBS.healthProbeIntervalSec),
  /** Where the worker reaches the app for Status page probes; defaults to this host's APP_PORT. */
  HEALTH_PROBE_URL: z.url().optional(),
  MEDIA_WORKER_CONCURRENCY: positiveInt.max(16).default(MEDIA.workerConcurrency),
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  /** Video conversions for unplayable containers running at once in the app (0 = off). */
  VIDEO_TRANSCODE_MAX: z.coerce.number().int().min(0).max(16).default(TRANSCODE.maxConcurrent),
});

export const observabilityEnv = z.object({
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).optional(),
  LOG_DIR: z.string().default("/var/log/relayfiles"),
  /**
   * Which process writes the logs: its files in LOG_DIR are <name>-error.log and
   * <name>-combined.log, so the app, the worker and admin scripts never rotate each other's
   * files. The worker and scripts set it themselves (scripts/worker.mts, scripts/lib/bootstrap.mts).
   */
  LOG_SERVICE: z.enum(["app", "worker", "tools"]).default("app"),
  DISK_DEVICE: z.string().default("/dev/sda"),
  TLS_CERT_PATH: z.string().optional(),
});
