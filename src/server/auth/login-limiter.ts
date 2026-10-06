import "server-only";
import { AUTH } from "@/config/policy";
import { getEnv } from "@/config/env";
import { lockSecondsAfter, type LockoutPolicy } from "@/domain/lockout";
import { redis } from "../redis";

/**
 * Failed token sign-ins per client address (docs/plan.md §13.2). Counters live in Redis
 * with TTLs, so a Redis flush only resets lockouts and never locks anyone out.
 */
const failKey = (ipKey: string) => `auth:fail:${ipKey}`;
const lockKey = (ipKey: string) => `auth:lock:${ipKey}`;
const signupKey = (ipKey: string) => `auth:signup:${ipKey}`;

/** INCR result of a MULTI; a failed transaction surfaces as an error. */
function firstResult(results: [Error | null, unknown][] | null): number {
  const [error, value] = results?.[0] ?? [new Error("Redis transaction was aborted."), 0];
  if (error) throw error;
  return Number(value);
}

export function lockoutPolicy(): LockoutPolicy {
  const env = getEnv("policy");
  return { maxAttempts: env.LOGIN_MAX_ATTEMPTS, lockSeconds: env.LOGIN_LOCK_SECONDS };
}

/** Seconds until sign-in is allowed again, or 0 when not locked. */
export async function lockRemaining(ipKey: string): Promise<number> {
  const ttl = await redis().ttl(lockKey(ipKey));
  return ttl > 0 ? ttl : 0;
}

/** Records a failure and returns the running count and the lock it caused (0 = none). */
export async function recordFailure(ipKey: string, policy: LockoutPolicy = lockoutPolicy()): Promise<{ failures: number; lockSeconds: number }> {
  const count = firstResult(await redis().multi().incr(failKey(ipKey)).expire(failKey(ipKey), AUTH.failureWindowSec).exec());
  const lockSeconds = lockSecondsAfter(count, policy);
  if (lockSeconds > 0) await redis().set(lockKey(ipKey), "1", "EX", lockSeconds);
  return { failures: count, lockSeconds };
}

export async function clearFailures(ipKey: string): Promise<void> {
  await redis().del(failKey(ipKey), lockKey(ipKey));
}

/** Counts an anonymous sign-up; false when the address exceeded the hourly limit. */
export async function allowSignup(ipKey: string): Promise<boolean> {
  const count = firstResult(await redis().multi().incr(signupKey(ipKey)).expire(signupKey(ipKey), AUTH.signupWindowSec, "NX").exec());
  return count <= getEnv("policy").SIGNUPS_PER_HOUR;
}
