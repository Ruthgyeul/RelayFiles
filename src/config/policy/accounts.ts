/** Accounts, sign-in, sessions, API tokens and server settings. Part of the product policy (src/config/policy.ts). */

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
  /**
   * The profile flags tokens nobody uses: never used this many days after creation, or not used
   * for staleAfterDays. A forgotten token is a standing way into the account; revoking it costs nothing.
   */
  unusedAfterDays: 7,
  staleAfterDays: 90,
  /** Tokens that stop working within this many days are flagged so the scripts using them can be updated. */
  expiringWarnDays: 7,
} as const;

/** Server settings (admin Settings page). */
export const SETTINGS = {
  /** The theme is read on every page; this long it comes from the cache. */
  themeCacheSec: 60,
} as const;

/** Invite codes for "Invite only" sign-ups (Server page). */
export const INVITE = {
  /** Accounts one code may create at most, and the choices the Server page offers. */
  maxUses: 100,
  useChoices: [1, 5, 10, 25],
  /** Days a code stays valid at most; the choices offered (null: no expiry date). */
  maxExpiryDays: 90,
  expiryChoices: [1, 7, 30, null],
  defaultExpiryDays: 7,
  /** Expired or used-up codes stay listed this long, then the daily cleanup removes them. */
  keepFinishedDays: 30,
} as const;

/** The account's own security log (profile "Security log"). */
export const SECURITY_LOG = {
  /** Entries are kept this long; the daily cleanup removes older ones. */
  retentionDays: 90,
  /** Entries the profile loads per page, and the most one request may ask for. */
  pageSize: 20,
  listLimit: 100,
  /** A rejected API token is logged at most once per token in this window. */
  rejectedTokenRepeatSec: 600,
} as const;

/** WebDAV (npm run dav): the files of an account as a network drive, signed in with a personal API token. */
export const DAV = {
  /** Requests one token may make per minute (file managers list folders often). */
  requestsPerMinute: 600,
  /** Path prefix the server answers below (Nginx forwards it unchanged). */
  prefix: "/dav",
} as const;
