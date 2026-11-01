/**
 * Product policy constants (single source). Deployment-specific overrides come from
 * `.env` through src/config/env.ts, which uses these values as defaults.
 */

export const MS = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

/** Writes that pick a random id or token, or create a row a parallel request may create too. */
export const DB_WRITE = {
  /** Tries in all when a unique index refuses the write (an id collision or a lost race). */
  uniqueRetryAttempts: 3,
} as const;

export const ACCOUNT = {
  /** Member accounts are deleted with their files this many days after creation. */
  ttlDays: 14,
  /** Days shown in the profile "Traffic" card. */
  trafficDays: 30,
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
  /** Directory layout version written to the volume marker (docs/runbook.md "스토리지 레이아웃"). */
  layoutVersion: 1,
  /** Free space kept on each volume; uploads are refused below it. */
  reservePercent: 5,
  /** How often the volume marker file is checked, in seconds. */
  volumeWatchIntervalSec: 30,
  /**
   * Deleted items stay in the volume's trash this long before they are removed for good (the
   * daily cleanup's first run after it); until then they can be restored from "Recently deleted".
   */
  trashRetentionHours: 24,
  /** Most items "Recently deleted" lists (newest first). */
  recentlyDeletedListMax: 1_000,
  /** Filesystem limits (ext4; the name limit is domain/names MAX_NAME_BYTES). */
  maxPathBytes: 4096,
  maxFolderDepth: 32,
  /**
   * Longest a DB transaction may stay open, in seconds. Storage transactions rename and create
   * folders on the volume, which can stall for seconds while a busy USB disk flushes writes;
   * Prisma's 5-second default then aborts the commit.
   */
  transactionTimeoutSec: 60,
  /**
   * Longest a volume move, a layout migration or `storage:fsck --fix` waits for the storage
   * transactions already running on an account or volume (they hold its write lock) before it
   * gives up, in seconds. Covers a long renumbering run (RENUMBER.transactionMsPerFile).
   */
  writeDrainTimeoutSec: 600,
  /**
   * Tries to lock a folder tree (a delete) or a file's folder chain (an upload linking to an
   * existing copy) that keeps changing meanwhile, before giving up.
   */
  subtreeLockAttempts: 5,
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
  /**
   * Files and folders one member account may hold (admins: no limit). Empty files cost no
   * quota, so without a count millions of them could use up the volume's inodes and the database.
   */
  maxItemsPerAccount: 100_000,
  /** Tags one item can carry. */
  maxTagsPerItem: 20,
} as const;

/** "Renumber files": renames the files of one folder to 01, 02, 03, … (docs/architecture.md "순번 정리"). */
export const RENUMBER = {
  /** Numbers are padded to at least this many digits ("01"); more files get more digits. */
  minDigits: 2,
  /** Default for RENUMBER_MAX_FILES: most files one run renames. */
  maxFiles: 10_000,
  /**
   * Each file is renamed twice on disk (to a temporary name, then to its number) inside one
   * storage transaction, whose time limit grows by this much per changed file beyond
   * STORAGE.transactionTimeoutSec (a slow USB disk included).
   */
  transactionMsPerFile: 20,
  /** Temporary names between the two steps; hidden (dot) names, so no run ever renumbers them. */
  tempPrefix: ".relayfiles-renumber-",
} as const;

/** "Find duplicates": files with the same content (SHA-256 and size). */
export const DUPLICATES = {
  /** Default for DUPLICATES_MAX_SCAN: most files one scan compares; a larger tree is reported as truncated. */
  maxScan: 10_000,
  /** Most duplicate groups returned, the ones wasting the most space first. */
  maxGroups: 500,
} as const;

/** Transfer panel per-file list. */
export const TRANSFERS = {
  /** Per-file list (dropdown) for batches with at least this many files. */
  fileListMin: 2,
  /** Speed samples kept for the per-file sparkline, one per speedSampleMs. */
  speedSamples: 30,
  speedSampleMs: 1_000,
  /** Per-file byte counts are applied to the panel at most this often (large batches stay smooth). */
  progressFlushMs: 150,
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
  /** Items a tag search (File Manager "#tag", global search) returns at most. */
  tagResultLimit: 500,
} as const;

export const UPLOAD = {
  /**
   * Earlier unfinished uploads of the same file (tus fingerprint) a new batch asks the server
   * to continue, newest first, before it sends the file from the start.
   */
  resumeCandidates: 3,
  /** tus chunk size; stays below Cloudflare's 100 MB request limit. */
  chunkSizeMb: 50,
  /** Incomplete upload chunks older than this are removed. */
  tmpTtlHours: 6,
  /**
   * tus upload locks live in Redis so every app process sees them: a lock lapses this long after
   * its last renewal (a crashed process cannot hold it for good), and a request waits at most
   * lockAcquireMs for one, asking the holder to let go every lockRetryMs.
   */
  lockLeaseMs: 30_000,
  lockAcquireMs: 30_000,
  lockRetryMs: 250,
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
  /** Entries the Activity dialog shows; a folder's log merges everything inside it. */
  activityListLimit: 200,
  /** Recent periods the Activity summary counts besides the whole kept log. */
  activitySummaryDays: [7, 30],
  /** Events the Activity CSV export holds (everything kept for a folder's items, newest first). */
  activityExportLimit: 10_000,
  /** Password unlocks one device remembers; the oldest are dropped first. */
  unlockCookieMaxLinks: 50,
  /** Links of expired items keep answering "This link has expired" for this long. */
  tombstoneDays: 90,
  /**
   * A counted download start lets the same visitor resume (Range requests past byte 0) for
   * this long; resuming later, or from another address, starts (and counts) a new download.
   */
  downloadGrantHours: 6,
} as const;

export const MEDIA = {
  /** Retry-After for a shared photo whose metadata-stripped copy the worker has not made yet. */
  stripPendingRetrySec: 5,
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
  /**
   * What ffmpeg may open for an uploaded file: the file itself, and only container formats of
   * real videos. Playlists (HLS), concat lists and other formats that point at further files are
   * refused, so a crafted upload cannot make ffmpeg read (and the transcoder stream back) other
   * files on the server. Names are ffmpeg demuxers (`ffmpeg -demuxers`); "mov" covers MP4, M4V
   * and 3GP, "matroska" covers WebM.
   */
  ffmpegProtocols: ["file"],
  ffmpegDemuxers: ["mov", "matroska", "avi", "asf", "mpegts", "mpeg", "flv", "ogg", "wav", "mp3"],
  /** Largest PNG frame read back from ffmpeg (a 8K frame fits); more stops the command. */
  maxFrameBytes: 256 * 1024 * 1024,
  /** Largest metadata listing read back from ffmpeg (`-f ffmetadata`, for the date taken). */
  maxMetadataBytes: 1024 * 1024,
  /**
   * What the browser may keep (playback bytes, thumbnails, previews, converted video). A file's
   * bytes never change under its URL (a replaced file gets a new id), so they are `immutable`:
   * replays, seeks back and returning to an earlier video come from the browser's cache with
   * no request to the server. Downloads are never cached (limits and counts need each request).
   */
  cacheMaxAgeSec: 365 * 24 * 60 * 60,
  workerConcurrency: 2,
  /**
   * A job that fails for a reason outside the file (storage I/O error, volume offline, all
   * conversion slots busy, a timeout) is tried again with exponential backoff from jobBackoffMs:
   * 6 attempts span about five minutes, long enough to re-plug an SSD.
   */
  jobAttempts: 6,
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

/** The media viewer's subtitles and slideshow. */
export const VIEWER = {
  /**
   * Subtitle files (.vtt/.srt next to a video) larger than this are not loaded. Same as the
   * text preview cap, so a share link's playback route serves them (`streamReach` for text).
   */
  subtitleMaxBytes: DOCUMENT_PREVIEW.textMaxBytes,
  /** How long each picture shows in a slideshow. */
  slideshowIntervalMs: 4_000,
} as const;

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

/** Status page: browser checks, history ranges and the rating thresholds. */
export const STATUS = {
  /** /api/health gives up on PostgreSQL, Redis or the volume after this long and reports it down. */
  healthCheckTimeoutMs: 2_000,
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
  /**
   * Longest one `npm run data:migrate` run holds the lock that keeps a second run (a k3s job and
   * a manual run) from processing the same batches, in hours. A longer run fails at the end and
   * the next run resumes from its cursor.
   */
  runLockHours: 24,
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
  adminSessionDays: 7,
  memberSessionDays: 14,
  /** Admin actions that expose or change accounts need the token entered again within this window. */
  reauthWindowMin: 10,
  /** Admin audit entries are kept this long. */
  auditRetentionDays: 365,
  /** Most audit entries one request returns. */
  auditListLimit: 200,
  /** Audit entries the admin screen loads per page. */
  auditPageSize: 50,
  /** The device cookie lives a year; the sessions inside it end with their own lifetimes. */
  sessionCookieMaxAgeSec: 365 * 24 * 60 * 60,
  /** Accounts signed in on one device at most. */
  maxSessionsPerDevice: 10,
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
  /**
   * A conversion slot (shared by every app process through Redis) lapses this long after its
   * last renewal, so a crashed process frees its slots; running conversions renew every third of it.
   */
  slotLeaseMs: 60_000,
  /**
   * A video converted live this many times within cacheWindowSec is converted once by the
   * worker and played from that file afterwards (system/transcoded, not counted toward quotas).
   */
  cacheAfterPlays: 3,
  cacheWindowSec: 7 * 24 * 60 * 60,
  /** Stored conversions are deleted this long after they were made (popular ones are made again). */
  cacheKeepDays: 30,
  /**
   * A stored conversion (worker) is stopped after this long. 720p converts faster than real
   * time on the N95, so this covers videos up to about this length; a longer or hung one is
   * stopped (SIGTERM, then SIGKILL) and not retried until it is played often enough again.
   */
  storeTimeoutSec: 6 * 60 * 60,
} as const;

/** Personal API tokens and /api/v1 (docs/api.md "API v1"). */
export const API = {
  /** Tokens one account may hold. */
  maxTokensPerAccount: 20,
  /** Longest token name. */
  nameMaxLength: 40,
  /** Lifetimes offered when a token is created, in days; null (no expiry) is offered too. */
  expiryDays: [7, 30, 90, 365],
  /** Requests one token may make per minute before 429. */
  requestsPerMinute: 120,
  /** "Last used" is written at most this often. */
  touchIntervalSec: 5 * 60,
  /** A token checked against its argon2 hash is trusted this long by the same process (the row is still read). */
  verifyCacheSec: 5 * 60,
  /** Tokens one process remembers as checked; the oldest is dropped first. */
  verifyCacheMax: 1_000,
} as const;

/** Upload-only links (file requests, /r/<id>; docs/api.md "파일 요청"). */
export const FILE_REQUEST = {
  /** Open requests one account may hold. */
  maxPerAccount: 50,
  /** Longest title shown to uploaders. */
  titleMaxLength: 80,
  /** Lifetimes offered when a request is created, in days; null (no expiry) is offered too. */
  expiryDays: [1, 7, 30],
  /** Largest "at most N files" limit the owner can set. */
  maxFilesLimit: 10_000,
  /** Files one visitor upload may contain (one drop or pick). */
  maxFilesPerBatch: 100,
  /** Upload batches one address may start per hour on one request. */
  batchesPerHour: 30,
  /** An expired request keeps answering "This link has expired" this long, then it is deleted. */
  expiredKeptDays: 30,
} as const;

/** Backup verification (deploy/scripts/verify-backup.sh, npm run backup:verify). */
export const BACKUP = {
  /** The newest dump must be at most this old: the daily backup plus some slack. */
  verifyMaxDumpAgeHours: 26,
  /**
   * Accounts, items and public links in the restored dump may be this many percent below
   * production (it is up to a day old); a bigger gap means the dump is missing data.
   */
  verifyMaxDriftPct: 20,
  /** Verification results kept for the history (one a week: a year). */
  checksKept: 52,
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
  /** Grouping and throttle keys in Redis expire after this long even if the worker never ran. */
  stateTtlSec: 24 * 60 * 60,
} as const;

/** k3s deployment (deploy/scripts/k3s/deploy.sh). */
export const K3S = {
  /** App replicas on the one storage node; more add memory, not storage throughput. */
  maxAppReplicas: 4,
} as const;

/** Defaults of the offsite restic backup (deploy/scripts/offsite-backup.sh; OFFSITE_* in .env). */
export const OFFSITE = {
  /** Snapshots `restic forget` keeps: the newest per day, week and month. */
  keepDaily: 7,
  keepWeekly: 4,
  keepMonthly: 6,
  /** Share of the repository's data the weekly check downloads and verifies. */
  checkPercent: 5,
  /** Shortest repository password accepted (it encrypts every offsite copy). */
  passwordMinLength: 16,
} as const;

/** Server settings (admin Settings page). */
export const SETTINGS = {
  /** The theme is read on every page; this long it comes from the cache. */
  themeCacheSec: 60,
} as const;

/** Defaults of the Nginx request limits (deploy env NGINX_*; both Nginx templates use them). */
export const NGINX = {
  /** Largest request body; tus chunks (UPLOAD_CHUNK_SIZE_MB, at most 95) must fit. */
  maxBodyMb: 100,
  /** Sign-in and account requests per client address per minute, and the burst allowed above it. */
  authRatePerMin: 20,
  authBurst: 20,
  /** Upload preparations per client address per minute, and the burst allowed above it. */
  uploadRatePerMin: 60,
  uploadBurst: 30,
  /**
   * Personal API token requests (/api/v1/, /metrics) per client address per minute, and the burst:
   * one token's own limit (API.requestsPerMinute), enforced before argon2 checks the token.
   */
  apiRatePerMin: API.requestsPerMinute,
  apiBurst: 60,
} as const;

/** Defaults of the stop grace periods (deploy env *_STOP_GRACE_SEC; compose, systemd and k3s use them). */
export const SHUTDOWN = {
  /** A stopping app finishes requests in flight (streams, zips, upload chunks) for this long before it is killed. */
  appStopGraceSec: 30,
  /** A stopping worker finishes its running jobs: an ffmpeg run (MEDIA.ffmpegTimeoutSec) plus the work around it. */
  workerStopGraceSec: 90,
} as const;

export const HEADERS = {
  /** Default for HSTS_MAX_AGE_SEC: one year, the minimum browsers' preload lists accept. */
  hstsMaxAgeSec: 365 * 24 * 60 * 60,
  /** Largest CSP violation report the app reads; browsers send a few hundred bytes. */
  cspReportMaxBytes: 16 * 1024,
  /** The same violation (directive + blocked resource) is logged at most once per this window. */
  cspReportDedupeSec: 60 * 60,
} as const;
