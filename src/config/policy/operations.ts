/** Metrics, status, background jobs, logs, notifications and shutdown. Part of the product policy (src/config/policy.ts). */

export const METRICS = {
  /** The Server page stream sends a snapshot this often (design: 1.5 s). */
  streamIntervalMs: 1_500,
  /** A stream re-reads its session this often and ends when the admin was signed out or demoted. */
  streamSessionCheckMs: 30_000,
  /** A stream ends after this long; the browser's EventSource reconnects (and is checked again). */
  streamMaxLifetimeMs: 60 * 60 * 1_000,
  /** Server page streams one account may hold open at once (each one samples the server). */
  streamMaxPerAccount: 3,
  /** Bandwidth and disk read/write history shown on the Server page, one bar per hour. */
  historyHours: 48,
  /** The hourly history changes once per sample, so the stream reuses it this long. */
  historyCacheSec: 15,
  /** Measured rates, sizes and percentages are stored and shown with at most this many decimals (10.21). */
  decimalPlaces: 2,
  /** A stream or upload counts as active if it was used this recently. */
  activeWindowSec: 60,
  /** The worker heartbeat expires after this many missed samples. */
  heartbeatMisses: 3,
  /** smartctl gives up after this long. */
  smartTimeoutSec: 10,
  /** Service checks (SMART, volumes) are slower than the stream, so they are reused this long. */
  servicesCacheSec: 30,
  /** The network link speed rarely changes; it is read again after this long. */
  linkCacheSec: 300,
} as const;

/** Live file lists: pages follow changes made elsewhere (another device, WebDAV, the CLI, the worker). */
export const LIVE = {
  /** At most one "changed" event per account stream this often; changes in between are merged. */
  coalesceMs: 1_000,
  /** A comment line this often keeps proxies and tunnels from closing an idle stream. */
  heartbeatMs: 25_000,
  /** A stream re-reads its session this often and ends when it was signed out. */
  sessionCheckMs: 60_000,
  /** A stream ends after this long; the browser's EventSource reconnects (and is checked again). */
  maxLifetimeMs: 60 * 60 * 1_000,
  /** Streams one account may hold open at once in one app process (one per open tab). */
  maxPerAccount: 10,
  /** The page refreshes this long after the last event, so a burst of changes is one refresh. */
  clientDebounceMs: 500,
  /** After a stream was refused or dropped for good, the page tries again after this long. */
  clientRetryMs: 30_000,
} as const;

/** Status page: browser checks, history ranges and the rating thresholds. */
export const STATUS = {
  /** /api/health gives up on PostgreSQL, Redis or the volume after this long and reports it down. */
  healthCheckTimeoutMs: 2_000,
  /** Requests to /api/health within this long share one check (it costs a DB, Redis and disk round trip). */
  healthCacheMs: 1_000,
  /** The browser checks the server this often while the page is open (design: 2.5 s). */
  pingIntervalMs: 2_500,
  /** Browser checks kept for the averages (design: last 40). */
  pingHistory: 40,
  /** Latency ratings: below `excellentMs` Excellent, `goodMs` Good, `fairMs` Fair, else Poor. */
  excellentMs: 100,
  goodMs: 250,
  fairMs: 500,
  /** The overall card turns "Degraded" above this average or loss. */
  degradedAvgMs: 400,
  degradedLossPercent: 5,
  /** Jitter ratings: below `stableJitterMs` Stable, `variableJitterMs` Some variation, else Unstable. */
  stableJitterMs: 30,
  variableJitterMs: 80,
  /** Latency chart: hours shown and the latency drawn as a full bar. */
  latencyHours: 48,
  latencyScaleMs: 600,
  minBarPercent: 4,
  /** Service strips and the server uptime ranges. */
  serviceDays: 60,
  uptimeDays: 90,
  /** A day is "Degraded" when any check failed, an "Outage" when more than this share failed. */
  outageFailPercent: 5,
  /** Response p50/p95 are computed over this many hours of probes. */
  responseWindowHours: 24,
  /** A component's latest probe counts as current for this many missed intervals. */
  freshProbes: 3,
  /** Raw probe samples and hourly rollups are kept this long; daily rollups are kept forever. */
  sampleRetentionHours: 72,
  hourlyRetentionDays: 7,
  /** The page refreshes the server-side history this often; the server reuses it this long. */
  refreshMs: 60_000,
  cacheSec: 15,
  /** Incidents listed on the page, newest first. */
  incidentsShown: 20,
  /** Probe request timeout. */
  probeTimeoutMs: 5_000,
} as const;

export const JOBS = {
  cleanupCron: "0 4 * * *",
  timezone: "Asia/Seoul",
  metricsSampleIntervalSec: 60,
  healthProbeIntervalSec: 60,
  /**
   * The probes queue (bandwidth sample, Status probe, volume watch) runs this many jobs at once,
   * one per kind, so a slow health probe never holds back the volume watch.
   */
  probeConcurrency: 3,
  /**
   * Finished maintenance and probe jobs kept in Redis (newest first) for inspection; older ones
   * are removed as new ones finish. The probes alone finish about 5,700 jobs a day.
   */
  keepCompleted: 100,
  keepFailed: 1_000,
  /**
   * At start the worker removes finished jobs older than this (left by releases that kept them
   * all), at most trimBatch per Redis call so a large backlog never blocks Redis for long.
   */
  trimFinishedAfterSec: 24 * 60 * 60,
  trimBatch: 1_000,
} as const;

/**
 * What a worker process runs (WORKER_ROLES): media = thumbnails, previews, stripped copies, stored
 * conversions and virus scans; maintenance = the daily cleanup and the probes (host bandwidth and
 * disk samples, Status page, volume watch); notify = owner notifications. Media can run in several
 * processes on several machines; maintenance must run in exactly one, on the storage host, since
 * its samples read that host's network and disks.
 */
export const WORKER_ROLES = ["media", "maintenance", "notify"] as const;

/** Production log files (LOG_DIR): rotated by size so a busy server cannot fill the disk. */
export const LOGS = {
  maxFileBytes: 20 * 1024 * 1024,
  /** Rotated files kept per log (error.log, combined.log). */
  maxFiles: 5,
} as const;

/**
 * Owner notifications through a webhook (NOTIFY_WEBHOOK_URL; docs/runbook.md "알림 설정"). The
 * worker sends them from the `notify` queue; the app and scripts only queue them.
 */
export const NOTIFY = {
  /** The webhook call gives up after this long (connect and response). */
  requestTimeoutMs: 10_000,
  /**
   * A failed call is tried again with exponential backoff from jobBackoffMs: 6 attempts span about
   * 30 minutes, long enough for a phone hotspot or the receiver to come back. 4xx answers other
   * than 408 and 429 are not retried (the URL or token is wrong).
   */
  jobAttempts: 6,
  jobBackoffMs: 60_000,
  /** Notifications sent at once (one receiver; order does not matter). */
  workerConcurrency: 1,
  /**
   * Files arriving through one upload-only link within this many seconds of the first are sent as
   * one notification (a visitor's drop of 100 photos is one message, not 100).
   */
  fileRequestGroupSec: 60,
  /** File names one notification lists; the rest are counted ("and 12 more"). */
  fileRequestListMax: 10,
  /** The same alert for the same volume is sent at most once per this window. */
  volumeLowRepeatHours: 12,
  volumeReadOnlyRepeatHours: 6,
  /** Offline and back-online alerts of one volume (a loose cable must not flood the phone). */
  volumeStatusRepeatMinutes: 30,
  /** Longest message text per format (Discord allows 2,000 characters, Telegram 4,096, ntfy 4,096 bytes). */
  maxChars: { json: 4_000, ntfy: 3_500, discord: 2_000, telegram: 4_000 },
  /** A share link's "opened" notification is sent again only when it was not opened for this long. */
  linkOpenRememberDays: 30,
  /** Grouping and throttle keys in Redis expire after this long even if the worker never ran. */
  stateTtlSec: 24 * 60 * 60,
} as const;

/** Defaults of the stop grace periods (deploy env *_STOP_GRACE_SEC; compose, systemd and k3s use them). */
export const SHUTDOWN = {
  /** A stopping app finishes requests in flight (streams, zips, upload chunks) for this long before it is killed. */
  appStopGraceSec: 30,
  /** A stopping worker finishes its running jobs: an ffmpeg run (MEDIA.ffmpegTimeoutSec) plus the work around it. */
  workerStopGraceSec: 90,
} as const;

/** Admin usage report (Accounts page "Usage report"). */
export const ADMIN_REPORT = {
  /** Days the report covers when no range is given, ending today (UTC). */
  defaultDays: 30,
  /** Longest range one report may cover. */
  maxDays: 366,
  /** Ranges the page offers, in days. */
  rangeChoices: [30, 90, 365],
} as const;
