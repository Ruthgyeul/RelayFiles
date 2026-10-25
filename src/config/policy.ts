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
  /** Deleted items stay in the volume's trash this long before they are removed for good. */
  trashRetentionHours: 24,
  /** Filesystem limits (ext4). */
  maxNameBytes: 255,
  maxPathBytes: 4096,
  maxFolderDepth: 32,
  /**
   * Longest a DB transaction may stay open, in seconds. Storage transactions rename and create
   * folders on the volume, which can stall for seconds while a busy USB disk flushes writes;
   * Prisma's 5-second default then aborts the commit.
   */
  transactionTimeoutSec: 60,
} as const;

export const FILES = {
  /** Most items one request may move, copy, delete, tag or zip. */
  maxBatchItems: 500,
  /** Longer lists let the browser skip rendering rows outside the screen (content-visibility). */
  lazyRenderAfter: 100,
  /** Height a lazy row is assumed to have before it renders (content-visibility estimate). */
  rowEstimatePx: 68,
  /** The same for rows with a media preview (288px square or audio player under the name). */
  previewRowEstimatePx: 370,
} as const;

/** Global search (design `gs*`, Ctrl/⌘ K). */
export const SEARCH = {
  /** Recent files listed before anything is typed. */
  recentItems: 8,
  /** Results shown for a name or tag query. */
  maxResults: 30,
  /** Name matches fetched before ranking. */
  nameCandidates: 200,
  /** Longest query accepted. */
  maxQueryLength: 200,
  /** Delay before a query runs while typing. */
  debounceMs: 150,
} as const;

export const UPLOAD = {
  /** tus chunk size; stays below Cloudflare's 100 MB request limit. */
  chunkSizeMb: 50,
  /** Incomplete upload chunks older than this are removed. */
  tmpTtlHours: 6,
} as const;

export const SHARE = {
  /** Downloads counted for the busy level (design: 10 minutes). */
  busyWindowMs: 600_000,
  /** Downloads in the window from which a file is "Busy" (throttled) and "Server busy" (paused). */
  busyThrottleAt: 5,
  busyPauseAt: 10,
  /** Speed of each download while a file is busy. */
  throttledBytesPerSec: 2_000_000,
  /** How long a password unlock lasts on a device. */
  unlockHours: 12,
  /** Wrong passwords allowed per link and address before a pause. */
  unlockMaxAttempts: 10,
  unlockWindowSec: 600,
  /** "Opened link" / "Played" are logged once per visitor and item in this window. */
  eventDedupeSec: 1_800,
  /** Link activity entries kept per item (design: 200). */
  eventsKeptPerNode: 200,
  /** Links of expired items keep answering "This link has expired" for this long. */
  tombstoneDays: 90,
} as const;

export const MEDIA = {
  /** Longest side of generated thumbnails (2x the 288px list preview). */
  thumbSizePx: 576,
  thumbQuality: 72,
  /**
   * Viewer previews: images are shown as a WebP fitting this box (sharp on any screen up to
   * 2560 px) instead of the original; the original stays one click away (Download).
   */
  previewSizePx: 2560,
  /** High enough to look identical to the original at the preview size. */
  previewQuality: 92,
  /** Smaller originals already open fast, so they are shown as they are. */
  previewMinBytes: 512 * 1024,
  /** Types sharp rewrites for the preview (GIF is left as is: it may be animated). */
  previewTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/tiff"],
  /** Video thumbnails use the frame at this time (or the first frame of shorter clips). */
  videoFrameSeconds: 1,
  /** Images larger than this get no metadata-stripped copy (held in memory while stripping). */
  maxStripBytes: 200_000_000,
  /** Largest image (in pixels) the thumbnailer decodes; stops decompression bombs. */
  maxInputPixels: 268_402_689,
  /** ffmpeg gives up after this long. */
  ffmpegTimeoutSec: 60,
  /** Largest PNG frame read back from ffmpeg (a 8K frame fits); more stops the command. */
  maxFrameBytes: 256 * 1024 * 1024,
  /**
   * What the browser may keep (playback bytes, thumbnails, previews, converted video). A file's
   * bytes never change under its URL (a replaced file gets a new id), so they are `immutable`:
   * replays, seeks back and returning to an earlier video come from the browser's cache with
   * no request to the server. Downloads are never cached (limits and counts need each request).
   */
  cacheMaxAgeSec: 365 * 24 * 60 * 60,
  workerConcurrency: 2,
  jobAttempts: 3,
  jobBackoffMs: 10_000,
} as const;

/** Cache-Control of responses whose bytes never change for their URL (see MEDIA.cacheMaxAgeSec). */
export const IMMUTABLE_CACHE = `private, max-age=${MEDIA.cacheMaxAgeSec}, immutable`;

/** The viewer's previews of files that are not media (text, code, tables, PDF, SVG, fonts, Word, Excel). */
export const DOCUMENT_PREVIEW = {
  /** Text files show at most this much from the start (one Range request, never the whole file). */
  textMaxBytes: 1024 * 1024,
  /** Longer text is shown without syntax colors (highlighting would hold up the page). */
  highlightMaxChars: 256 * 1024,
  /** Bytes checked for NUL characters to tell binary files from text. */
  sniffBytes: 8 * 1024,
  /** Rows of a table (CSV/TSV, a spreadsheet sheet) shown, not counting the header. */
  tableMaxRows: 1000,
  /** Columns of a table shown. */
  tableMaxColumns: 100,
  /** SVGs, fonts, Word and Excel files larger than this are not loaded for a preview (read whole). */
  assetMaxBytes: 20 * 1024 * 1024,
  /** PDF pages start rendering this far before they scroll into view. */
  pdfPreloadMarginPx: 800,
  /** Highest pixel ratio PDF pages are drawn at (sharp on 2x screens, bounded memory). */
  pdfMaxPixelRatio: 2,
  /** Width PDF pages are laid out at before the stage has been measured. */
  pdfFallbackWidthPx: 800,
} as const;

export const METRICS = {
  /** The Server page stream sends a snapshot this often (design: 1.5 s). */
  streamIntervalMs: 1_500,
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

/** Status page (design `isStatus`): browser checks, history ranges and the rating thresholds. */
export const STATUS = {
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

/** Data migrations and key rotation (docs/runbook.md "마이그레이션"). */
export const MIGRATION = {
  /** Rows processed per batch; progress is saved after each batch so a run can resume. */
  batchSize: 1_000,
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
  /**
   * A device session ends this long after sign-in, whatever the account's own lifetime (admin
   * accounts never expire, so their sessions would otherwise last for good).
   */
  adminSessionDays: 14,
  memberSessionDays: 90,
  /** Admin actions that expose or change accounts need the token entered again within this window. */
  reauthWindowMin: 10,
  /** Admin audit entries are kept this long. */
  auditRetentionDays: 365,
} as const;

/** Production log files (LOG_DIR): rotated by size so a busy server cannot fill the disk. */
export const LOGS = {
  maxFileBytes: 20 * 1024 * 1024,
  /** Rotated files kept per log (error.log, combined.log). */
  maxFiles: 5,
} as const;

/** Child processes (ffmpeg, smartctl) started through runCommand. */
export const PROCESS = {
  /** After a timeout the child gets SIGTERM, then SIGKILL if it is still running this much later. */
  killGraceMs: 2_000,
  /** Output kept per stream unless the caller sets its own limit; more stops the command. */
  maxOutputBytes: 1024 * 1024,
  /** Error output kept for messages and logs (the rest is dropped, not buffered). */
  maxStderrBytes: 4_096,
} as const;

/**
 * Videos in containers browsers cannot play (AVI, WMV, MPEG-TS, ...) are converted while they
 * play: ffmpeg writes fragmented MP4 (H.264/AAC) that starts before the conversion ends.
 */
export const TRANSCODE = {
  /** Default for VIDEO_TRANSCODE_MAX: conversions running at once (CPU-heavy). */
  maxConcurrent: 2,
  /** Output height limit: 720p converts faster than real time on a small server. */
  maxHeightPx: 720,
  /** x264 speed/size trade-off and quality (lower CRF = better and larger). */
  preset: "veryfast",
  crf: 23,
  audioBitrate: "128k",
  /** One conversion stops after this much output (bounds a single request). */
  maxOutputBytes: 4 * 1024 * 1024 * 1024,
  /** Retry-After sent while every conversion slot is in use. */
  busyRetrySec: 10,
} as const;
