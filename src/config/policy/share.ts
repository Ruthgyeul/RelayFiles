/** Share links. Part of the product policy (src/config/policy.ts). */

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
  /** The same per link and network (IPv4 /24, IPv6 /48) in the same window: many addresses of one block. */
  unlockNetworkMaxAttempts: 30,
  /**
   * Guesses at one password from everywhere together per window. Spread over many networks
   * (a botnet) they still run out; the cost is that such an attack also pauses honest
   * visitors of that link for up to this window.
   */
  unlockSubjectMaxAttempts: 200,
  unlockSubjectWindowSec: 3_600,
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
  /**
   * Most items (files and folders at any depth) one "Download all" zip of a folder in a link
   * holds: the zip reads the folder's whole visible tree into memory first. As many as a member
   * account can hold (FILES.maxItemsPerAccount), so only admin folders larger than that are refused.
   */
  zipMaxItems: 100_000,
  /**
   * "Download all" checks (HEAD, counts nothing) per address and window: each one walks the
   * folder's tree in the database, so they are limited like guesses rather than left open.
   */
  zipChecksPerAddress: 30,
  zipCheckWindowSec: 60,
  /**
   * Share page lookups of links that do not exist (or are private) per address and window.
   * Past it, every link answers "not found" to that address until the window ends, so ids
   * cannot be guessed at speed; nobody mistypes this many links in an hour.
   */
  linkMissesPerAddress: 30,
  linkMissWindowSec: 3_600,
} as const;
