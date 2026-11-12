/** Storage volumes, database writes, migrations and backups. Part of the product policy (src/config/policy.ts). */

/** Writes that pick a random id or token, or create a row a parallel request may create too. */
export const DB_WRITE = {
  /** Tries in all when a unique index refuses the write (an id collision or a lost race). */
  uniqueRetryAttempts: 3,
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
   * The default of TRASH_RETENTION_HOURS; read it through trashRetentionHours().
   */
  trashRetentionHours: 24,
  /** Longest TRASH_RETENTION_HOURS (30 days): deleted bytes keep counting toward the quota meanwhile. */
  trashRetentionMaxHours: 720,
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
