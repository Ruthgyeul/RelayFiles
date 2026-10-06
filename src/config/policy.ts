/**
 * Product policy constants (single source). Deployment-specific overrides come from
 * `.env` through src/config/env.ts, which uses these values as defaults.
 */

export const MS = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

export const ACCOUNT = {
  /** Member accounts are deleted with their files this many days after creation. */
  ttlDays: 14,
  /** Storage quota for new member accounts, in GB (decimal, 1 GB = 1e9 bytes like the design). */
  defaultQuotaGb: 5,
} as const;

export const LOGIN = {
  /** Failed token sign-ins allowed before a lockout. */
  maxAttempts: 5,
  /** Lockout durations for the 1st, 2nd and later lockouts, in seconds. */
  lockSeconds: [30, 120, 600],
} as const;

export const STORAGE = {
  /** Directory layout version written to the volume marker (docs/plan.md §13.8 ②). */
  layoutVersion: 1,
  /** Free space kept on each volume; uploads are refused below it. */
  reservePercent: 5,
  /** How often the volume marker file is checked, in seconds. */
  volumeWatchIntervalSec: 30,
  /** Upload/quota warning levels (percent of quota). */
  quotaWarnPercent: 80,
  quotaFullPercent: 95,
  /** Filesystem limits (ext4). */
  maxNameBytes: 255,
  maxPathBytes: 4096,
  maxFolderDepth: 32,
} as const;

export const FILES = {
  /** Most items one request may move, copy, delete, tag or zip. */
  maxBatchItems: 500,
} as const;

export const UPLOAD = {
  /** tus chunk size; stays below Cloudflare's 100 MB request limit. */
  chunkSizeMb: 50,
  /** Incomplete upload chunks older than this are removed. */
  tmpTtlHours: 6,
} as const;

export const JOBS = {
  cleanupCron: "0 4 * * *",
  timezone: "Asia/Seoul",
  metricsSampleIntervalSec: 60,
  healthProbeIntervalSec: 60,
} as const;

export const AUTH = {
  /** Failed sign-ins are forgotten after this long without another failure. */
  failureWindowSec: 24 * 60 * 60,
  /** Default for SIGNUPS_PER_HOUR: anonymous accounts one address may create per hour (stops crawlers filling the disk). */
  signupsPerHour: 10,
  signupWindowSec: 60 * 60,
  /** Session "last seen" is written at most this often. */
  touchIntervalSec: 5 * 60,
} as const;
