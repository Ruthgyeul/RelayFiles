/** Environment group schemas: storage volumes and uploads. Assembled in src/config/env.ts. */
import { z } from "zod";
import { STORAGE, UPLOAD } from "../policy";
import { bool, positiveInt } from "./fields";

export const storageEnv = z.object({
  STORAGE_ROOT: z.string().default("./.data/relayfilesDB"),
  STORAGE_RESERVE_PERCENT: z.coerce.number().min(0).max(50).default(STORAGE.reservePercent),
  STORAGE_UID: positiveInt.default(10001),
  STORAGE_GID: positiveInt.default(10001),
  STORAGE_ACCEL_ENABLED: bool.default(false),
  STORAGE_ACCEL_PREFIX: z.string().startsWith("/").endsWith("/").default("/_protected/"),
  VOLUME_WATCH_INTERVAL_SEC: positiveInt.default(STORAGE.volumeWatchIntervalSec),
  /** Copies and re-uploads of the same content share their bytes (hard links on the volume). */
  STORAGE_DEDUPE: bool.default(true),
});

export const uploadsEnv = z.object({
  UPLOAD_CHUNK_SIZE_MB: positiveInt.max(95).default(UPLOAD.chunkSizeMb),
  UPLOAD_MAX_FILE_SIZE_GB: z.coerce.number().positive().optional(),
  UPLOAD_TMP_TTL_HOURS: positiveInt.default(UPLOAD.tmpTtlHours),
});
