import "server-only";
import { getEnv } from "@/config/env";
import { MS } from "@/config/policy";
import { redis } from "../redis";

/**
 * Bytes promised to uploads that started but have not finished (docs/security.md "업로드").
 * Quota and free-space checks see only finished files, so without these, uploads started at
 * the same time would each pass the check and together overrun the quota or the disk.
 *
 * Each scope (an account, a volume, all anonymous accounts, an upload-only link) is a sorted set of upload ids
 * scored by when the promise lapses, plus a hash of their sizes. A reservation lapses after
 * UPLOAD_TMP_TTL_HOURS, when the maintenance job removes the unfinished chunks anyway.
 */
export type ReservationScope =
  | { kind: "account"; id: string }
  | { kind: "volume"; id: string }
  | { kind: "anon" }
  /** An upload-only link's own limits: bytes, and files (each upload reserves 1). */
  | { kind: "request-bytes"; id: string }
  | { kind: "request-files"; id: string };

const scopeName = (scope: ReservationScope) => (scope.kind === "anon" ? "anon" : `${scope.kind}:${scope.id}`);
const keysOf = (scope: ReservationScope) => [`quota:resv:${scopeName(scope)}:at`, `quota:resv:${scopeName(scope)}:size`];
const ttlMs = () => getEnv("uploads").UPLOAD_TMP_TTL_HOURS * MS.hour;

/**
 * Sums each scope's live reservations (dropping lapsed ones) and, when every scope stays
 * within its limit with the new upload, records it in all of them. Returns 0 on success, else
 * the 1-based scope that is full. One script, so concurrent starts cannot both slip in.
 * KEYS: zset, hash per scope. ARGV: now, lapsesAt, uploadId, size, ttlMs, limit per scope (-1 = none).
 */
const RESERVE_SCRIPT = `
local now, lapses, id, size, ttl = tonumber(ARGV[1]), ARGV[2], ARGV[3], tonumber(ARGV[4]), ARGV[5]
local scopes = #KEYS / 2
for i = 1, scopes do
  local at, sizes = KEYS[2 * i - 1], KEYS[2 * i]
  for _, lapsed in ipairs(redis.call('ZRANGEBYSCORE', at, '-inf', now)) do redis.call('HDEL', sizes, lapsed) end
  redis.call('ZREMRANGEBYSCORE', at, '-inf', now)
  local limit = tonumber(ARGV[5 + i])
  if limit >= 0 then
    local total = 0
    for _, value in ipairs(redis.call('HVALS', sizes)) do total = total + tonumber(value) end
    if redis.call('HEXISTS', sizes, id) == 1 then total = total - tonumber(redis.call('HGET', sizes, id)) end
    if total + size > limit then return i end
  end
end
for i = 1, scopes do
  local at, sizes = KEYS[2 * i - 1], KEYS[2 * i]
  redis.call('ZADD', at, lapses, id)
  redis.call('HSET', sizes, id, size)
  redis.call('PEXPIRE', at, ttl)
  redis.call('PEXPIRE', sizes, ttl)
end
return 0
`;

export interface ScopeLimit {
  scope: ReservationScope;
  /** Bytes the scope may hold in reservations (space left by finished files), or null for no limit. */
  limit: bigint | null;
}

/** Reserves `size` bytes for an upload in every scope, or returns the first scope that is full. */
export async function reserveUpload(uploadId: string, size: number, limits: readonly ScopeLimit[], now = Date.now()): Promise<ScopeLimit | null> {
  const keys = limits.flatMap(({ scope }) => keysOf(scope));
  const args = [now, now + ttlMs(), uploadId, size, ttlMs(), ...limits.map(({ limit }) => (limit === null ? -1 : limit < 0n ? 0 : limit.toString()))];
  const full = Number(await redis().eval(RESERVE_SCRIPT, keys.length, ...keys, ...args.map(String)));
  return full === 0 ? null : (limits[full - 1] ?? null);
}

/** Bytes reserved by unfinished uploads in a scope (lapsed reservations do not count). */
export async function reservedBytes(scope: ReservationScope, now = Date.now()): Promise<bigint> {
  const [at, sizes] = keysOf(scope) as [string, string];
  const live = await redis().zrangebyscore(at, now, "+inf");
  if (live.length === 0) return 0n;
  const values = await redis().hmget(sizes, ...live);
  return values.reduce((sum, value) => sum + BigInt(value ?? 0), 0n);
}

/** Drops an upload's reservation once it finished (its bytes now count as used) or was cancelled. */
export async function releaseUpload(uploadId: string, scopes: readonly ReservationScope[]): Promise<void> {
  const multi = redis().multi();
  for (const scope of scopes) {
    const [at, sizes] = keysOf(scope) as [string, string];
    multi.zrem(at, uploadId);
    multi.hdel(sizes, uploadId);
  }
  await multi.exec();
}
