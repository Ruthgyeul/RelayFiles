/** Deployment defaults (Nginx, Redis, k3s) and response headers. Part of the product policy (src/config/policy.ts). */
import { API } from "./accounts";

/** k3s deployment (deploy/scripts/k3s/deploy.sh). */
export const K3S = {
  /** App replicas on the one storage node; more add memory, not storage throughput. */
  maxAppReplicas: 4,
} as const;

/** Defaults of the Nginx request limits (deploy env NGINX_*; both Nginx templates use them). */
/** Redis as the deployment files start it (docker compose, k3s). */
export const REDIS_SERVER = {
  /** Default for REDIS_MAXMEMORY_MB: queues, limits and reservations take a few MB on this server. */
  maxMemoryMb: 256,
} as const;

export const NGINX = {
  /** Largest request body; tus chunks (UPLOAD_CHUNK_SIZE_MB, at most 95) must fit. */
  maxBodyMb: 100,
  /** Sign-in and account requests per client address per minute, and the burst allowed above it. */
  authRatePerMin: 20,
  authBurst: 20,
  /** Upload preparations per client address per minute, and the burst allowed above it. */
  uploadRatePerMin: 60,
  uploadBurst: 30,
  /** New tus uploads (one per file) per address: a folder of small files sends many in a row. */
  tusRatePerMin: 600,
  tusBurst: 120,
  /**
   * Personal API token requests (/api/v1/, /metrics) per client address per minute, and the burst:
   * one token's own limit (API.requestsPerMinute), enforced before argon2 checks the token.
   */
  apiRatePerMin: API.requestsPerMinute,
  apiBurst: 60,
} as const;

export const HEADERS = {
  /** Default for HSTS_MAX_AGE_SEC: one year, the minimum browsers' preload lists accept. */
  hstsMaxAgeSec: 365 * 24 * 60 * 60,
  /** Largest CSP violation report the app reads; browsers send a few hundred bytes. */
  cspReportMaxBytes: 16 * 1024,
  /** The same violation (directive + blocked resource) is logged at most once per this window. */
  cspReportDedupeSec: 60 * 60,
  /** Violations read from one report body (a page reports a handful; the rest is ignored). */
  cspReportMaxPerBody: 10,
  /** Report bodies taken per address and window (cspReportWindowSec); more are dropped unread. */
  cspReportsPerAddress: 60,
  cspReportWindowSec: 60 * 60,
  /** Violation log lines per window from all reporters together, so reports cannot flood the logs. */
  cspReportLogLinesPerWindow: 200,
} as const;
