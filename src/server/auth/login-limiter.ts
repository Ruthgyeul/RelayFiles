import "server-only";
import { AUTH } from "@/config/policy";
import { getEnv } from "@/config/env";
import type { LockoutPolicy } from "@/domain/lockout";
import { countInWindow, redis } from "../redis";

/**
 * Failed token sign-ins per client address (docs/security.md "인증"). Counters live in Redis
 * with TTLs, so a Redis flush only resets lockouts and never locks anyone out.
 */
const failKey = (ipKey: string) => `auth:fail:${ipKey}`;
const lockKey = (ipKey: string) => `auth:lock:${ipKey}`;
const signupKey = (ipKey: string) => `auth:signup:${ipKey}`;

export function lockoutPolicy(): LockoutPolicy {
  const env = getEnv("policy");
  return { maxAttempts: env.LOGIN_MAX_ATTEMPTS, lockSeconds: env.LOGIN_LOCK_SECONDS };
}

/**
 * Counts a token entry before the token is checked, in one script: refused while the address
 * is locked; otherwise the attempt is counted and, on every LOGIN_MAX_ATTEMPTS-th one, the
 * next lock of the ladder starts (the ladder of domain `lockSecondsAfter`). Counting first means parallel guesses cannot all slip in
 * before the lock is set. KEYS: failures, lock. ARGV: window seconds, max attempts, ladder...
 * Returns [-1, seconds left] when locked, else [attempts, lock seconds started (0 = none)].
 */
const ATTEMPT_SCRIPT = `
local locked = redis.call('TTL', KEYS[2])
if locked > 0 then return {-1, locked} end
local count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
local max = tonumber(ARGV[2])
local lock = 0
if count % max == 0 then
  local ladder = #ARGV - 2
  lock = tonumber(ARGV[2 + math.min(count / max, ladder)])
  redis.call('SET', KEYS[2], '1', 'EX', lock)
end
return {count, lock}
`;

export type TokenAttempt = { locked: number } | { failures: number; lockSeconds: number };

/** Counts a token entry from this address (see ATTEMPT_SCRIPT); `locked` when it must be refused unchecked. */
export async function beginTokenAttempt(ipKey: string, policy: LockoutPolicy = lockoutPolicy()): Promise<TokenAttempt> {
  const [count, seconds] = (await redis().eval(ATTEMPT_SCRIPT, 2, failKey(ipKey), lockKey(ipKey), AUTH.failureWindowSec, policy.maxAttempts, ...policy.lockSeconds)) as [number, number];
  return count < 0 ? { locked: seconds } : { failures: count, lockSeconds: seconds };
}

/**
 * Gives back the attempt of a correct token. Only that one attempt: the address's earlier
 * failures stay counted (they may have been guesses at other accounts), and a lock this very
 * attempt started is lifted.
 */
export async function refundTokenAttempt(ipKey: string, attempt: { lockSeconds: number }): Promise<void> {
  const multi = redis().multi().decr(failKey(ipKey));
  if (attempt.lockSeconds > 0) multi.del(lockKey(ipKey));
  await multi.exec();
}

/** Forgets an address's failures and lock (tests and operator tools). */
export async function clearFailures(ipKey: string): Promise<void> {
  await redis().del(failKey(ipKey), lockKey(ipKey));
}

/** Counts an anonymous sign-up; false when the address exceeded the hourly limit. */
export async function allowSignup(ipKey: string): Promise<boolean> {
  return (await countInWindow(signupKey(ipKey), AUTH.signupWindowSec)) <= getEnv("policy").SIGNUPS_PER_HOUR;
}
