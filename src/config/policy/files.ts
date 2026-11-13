/** Files and folders: uploads, transfers, search and file tools. Part of the product policy (src/config/policy.ts). */

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
  /** Items one account can keep in Favorites (each item is listed there once). */
  maxFavorites: 500,
  /** Organizing folders one account can make inside Favorites. */
  maxFavoriteFolders: 200,
  /** Levels of organizing folders inside Favorites (1: directly inside it). */
  favoriteFolderMaxDepth: 8,
  /** Folders a Favorites URL may open below a favorite folder (/files/favorites/<favorite>/<sub>/…). */
  maxFavoriteChain: 64,
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
  /** Largest "at most N MB" limit the owner can set (10 TB: above any disk, below the bigint column). */
  maxMbLimit: 10_000_000,
  /** Files one visitor upload may contain (one drop or pick). */
  maxFilesPerBatch: 100,
  /** Upload batches one address may start per hour on one request. */
  batchesPerHour: 30,
  /** An expired request keeps answering "This link has expired" this long, then it is deleted. */
  expiredKeptDays: 30,
} as const;

/**
 * Installed app (PWA) and Web Share Target (docs/architecture.md "설치 앱과 공유 대상"). Files
 * shared from another app are posted to `action`; the service worker (public/sw.js, which repeats
 * these values: pwa.test.ts checks) keeps them in memory and opens `page`, which uploads them.
 */
export const SHARE_TARGET = {
  /** Where the share sheet posts the files (manifest share_target.action). */
  action: "/share-target/receive",
  /** The page that shows the shared files and uploads them to a new Home folder. */
  page: "/share-target",
  /** Form field of the shared files (manifest share_target.params.files.name). */
  filesField: "files",
  /** The service worker drops shared files no page has picked up after this long (browsers stop an idle worker after 5 minutes). */
  holdMs: 3 * 60_000,
  /** The page stops waiting for the service worker's answer after this long. */
  claimTimeoutMs: 5_000,
} as const;
