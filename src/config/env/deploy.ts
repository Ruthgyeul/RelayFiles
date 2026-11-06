/** Environment group schemas: deployment files (Nginx, compose, systemd, k3s), the offsite backup and owner notifications. Assembled in src/config/env.ts. */
import { z } from "zod";
import { K3S, NGINX, OFFSITE, REDIS_SERVER, SHUTDOWN } from "../policy";
import { NOTIFY_FORMATS, cpus, memorySize, port, positiveInt, webhookUrl } from "./fields";

export const deployEnv = z.object({
  /** Nginx server_name: the host names served (space-separated); other names get 444, "_" serves every name. */
  SERVER_NAME: z.string().default("localhost"),
  /** Host address Nginx is published on: 127.0.0.1 when another proxy on the host sits in front. */
  NGINX_LISTEN_HOST: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).default("0.0.0.0"),
  NGINX_LISTEN_PORT: port.default(80),
  /** Nginx request limits (both templates): body size in MB, and per-minute rates with bursts. */
  NGINX_MAX_BODY_MB: positiveInt.max(1_024).default(NGINX.maxBodyMb),
  NGINX_AUTH_RATE_PER_MIN: positiveInt.default(NGINX.authRatePerMin),
  NGINX_AUTH_BURST: positiveInt.default(NGINX.authBurst),
  NGINX_UPLOAD_RATE_PER_MIN: positiveInt.default(NGINX.uploadRatePerMin),
  NGINX_UPLOAD_BURST: positiveInt.default(NGINX.uploadBurst),
  NGINX_TUS_RATE_PER_MIN: positiveInt.default(NGINX.tusRatePerMin),
  NGINX_TUS_BURST: positiveInt.default(NGINX.tusBurst),
  /** Personal API token requests (/api/v1/, /metrics) per client address per minute, and the burst. */
  NGINX_API_RATE_PER_MIN: positiveInt.default(NGINX.apiRatePerMin),
  NGINX_API_BURST: positiveInt.default(NGINX.apiBurst),
  CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
  /**
   * Memory Redis may use, in MB (compose and k3s `--maxmemory`, with `noeviction`: when full,
   * writes fail loudly instead of dropping queued jobs, upload reservations or lockouts).
   */
  REDIS_MAXMEMORY_MB: positiveInt.default(REDIS_SERVER.maxMemoryMb),
  /** Host directory for PostgreSQL, Redis and backups (docker compose). */
  DATA_DIR: z.string().startsWith("/").default("/srv/relayfiles"),
  /** Docker's data-root (images, containers, build cache); set by deploy/scripts/setup-docker.sh. */
  DOCKER_DATA_ROOT: z.string().startsWith("/").default("/var/lib/docker"),
  /** Private network of the compose services; cloudflared gets a fixed address in it. */
  DOCKER_SUBNET: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/).default("172.28.0.0/24"),
  CLOUDFLARED_IP: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).default("172.28.0.250"),
  /** Peer address of a proxy on the host (the DOCKER_SUBNET gateway); Nginx trusts its X-Real-IP. */
  TRUSTED_PROXY_IP: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).optional(),
  /** Container log rotation (docker compose json-file driver): size per file and files kept. */
  DOCKER_LOG_MAX_SIZE: z.string().regex(/^\d+[kmg]$/).default("10m"),
  DOCKER_LOG_MAX_FILE: positiveInt.default(5),
  /** Memory (K/M/G) and CPU cores the app and the worker may use (compose limits, systemd MemoryMax/CPUQuota). */
  APP_MEMORY_MAX: memorySize.default("2G"),
  APP_CPUS: cpus.default(3),
  WORKER_MEMORY_MAX: memorySize.default("2G"),
  WORKER_CPUS: cpus.default(2),
  /**
   * Seconds a stopping app or worker gets to finish requests or jobs before it is killed (compose
   * stop_grace_period, systemd TimeoutStopSec, k3s terminationGracePeriodSeconds).
   */
  APP_STOP_GRACE_SEC: positiveInt.default(SHUTDOWN.appStopGraceSec),
  WORKER_STOP_GRACE_SEC: positiveInt.default(SHUTDOWN.workerStopGraceSec),
  /** k3s deployment (deploy/scripts/k3s/deploy.sh): GHCR image name without -app/-tools, namespace, app replicas. */
  K3S_IMAGE_REPO: z
    .string()
    .regex(/^[a-z0-9.-]+(:\d+)?(\/[a-z0-9._-]+)+$/, "must be a registry path such as ghcr.io/<owner>/relayfiles")
    .optional(),
  K3S_NAMESPACE: z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/).default("relayfiles"),
  K3S_APP_REPLICAS: positiveInt.max(K3S.maxAppReplicas).default(1),
});

export const offsiteEnv = z
  .object({
    /**
     * restic repository for deploy/scripts/offsite-backup.sh, e.g. an S3 bucket on Cloudflare R2
     * or Backblaze B2 (`s3:https://<endpoint>/<bucket>/relayfiles`). Empty: no offsite backup.
     */
    RESTIC_REPOSITORY: z
      .string()
      .regex(/^(s3|b2|sftp|rest|azure|gs|swift|rclone):/, "must start with a restic backend such as s3:")
      .optional(),
    /** Encrypts every offsite copy; keep a copy away from the server too, it cannot be recovered. */
    RESTIC_PASSWORD: z.string().min(OFFSITE.passwordMinLength).optional(),
    /** S3 credentials of the repository (passed to restic as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). */
    OFFSITE_ACCESS_KEY_ID: z.string().optional(),
    OFFSITE_SECRET_ACCESS_KEY: z.string().optional(),
    OFFSITE_KEEP_DAILY: positiveInt.default(OFFSITE.keepDaily),
    OFFSITE_KEEP_WEEKLY: positiveInt.default(OFFSITE.keepWeekly),
    OFFSITE_KEEP_MONTHLY: positiveInt.default(OFFSITE.keepMonthly),
    OFFSITE_CHECK_PERCENT: z.coerce.number().positive().max(100).default(OFFSITE.checkPercent),
    /** More directories to back up, space-separated (the users/ folders of extra volumes). */
    OFFSITE_EXTRA_PATHS: z
      .string()
      .regex(/^\/\S*( \/\S*)*$/, "must be absolute paths separated by spaces")
      .optional(),
  })
  .refine((env) => !env.RESTIC_REPOSITORY || env.RESTIC_PASSWORD, { message: "RESTIC_PASSWORD is required with RESTIC_REPOSITORY", path: ["RESTIC_PASSWORD"] });

export const notifyEnv = z
  .object({
    /** Owner notifications (file requests, low or offline volumes, failed backup checks). Empty: off. */
    NOTIFY_WEBHOOK_URL: webhookUrl.optional(),
    /** Body the receiver expects: generic JSON, ntfy (topic URL), Discord webhook, Telegram Bot API sendMessage. */
    NOTIFY_WEBHOOK_FORMAT: z.enum(NOTIFY_FORMATS).default("json"),
    /** Sent as `Authorization: Bearer <token>` (an ntfy access token, a generic receiver's secret). */
    NOTIFY_WEBHOOK_TOKEN: z.string().min(1).optional(),
    /** Telegram only: the chat the bot writes to (numeric id or @channel). */
    NOTIFY_TELEGRAM_CHAT_ID: z
      .string()
      .regex(/^(-?\d+|@\w{5,})$/, "must be a numeric chat id or @channelname")
      .optional(),
  })
  .refine((env) => env.NOTIFY_WEBHOOK_FORMAT !== "telegram" || !env.NOTIFY_WEBHOOK_URL || env.NOTIFY_TELEGRAM_CHAT_ID, {
    message: "NOTIFY_TELEGRAM_CHAT_ID is required with NOTIFY_WEBHOOK_FORMAT=telegram",
    path: ["NOTIFY_TELEGRAM_CHAT_ID"],
  });
