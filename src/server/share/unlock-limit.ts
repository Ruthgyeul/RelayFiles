import "server-only";
import { SHARE } from "@/config/policy";
import type { ClientInfo } from "../auth/client-info";
import { ApiError } from "../http/api-error";
import { countInWindow, redis } from "../redis";

interface Budget {
  key: string;
  windowSec: number;
  max: number;
}

/**
 * The guess budgets of one password (`subject`: the item or upload-only link holding it): this
 * address, its network (many addresses of one provider block share it) and the password as a
 * whole, so guesses spread over a botnet or an IPv6 range still run out.
 */
function budgetsOf(subject: string, client: Pick<ClientInfo, "ipKey" | "networkKey">): Budget[] {
  return [
    { key: `unlock:${subject}:${client.ipKey}`, windowSec: SHARE.unlockWindowSec, max: SHARE.unlockMaxAttempts },
    { key: `unlock:net:${subject}:${client.networkKey}`, windowSec: SHARE.unlockWindowSec, max: SHARE.unlockNetworkMaxAttempts },
    { key: `unlock:all:${subject}`, windowSec: SHARE.unlockSubjectWindowSec, max: SHARE.unlockSubjectMaxAttempts },
  ];
}

/**
 * Counts one password guess at `subject` before the password is checked (argon2 is the costly
 * part); 429 with Retry-After once any budget is spent. Returns what to give back when the
 * guess was right ({@link refundUnlockGuess}).
 */
export async function countUnlockGuess(subject: string, client: Pick<ClientInfo, "ipKey" | "networkKey">): Promise<string[]> {
  const budgets = budgetsOf(subject, client);
  const counts = await Promise.all(budgets.map((budget) => countInWindow(budget.key, budget.windowSec)));
  const spent = budgets.find((budget, index) => counts[index]! > budget.max);
  if (spent) throw new ApiError("RATE_LIMITED", "Too many wrong passwords. Try again later.", { retryAfter: Math.max(1, await redis().ttl(spent.key)) });
  return budgets.map((budget) => budget.key);
}

/** A right password gives back only its own guess: earlier wrong guesses still count. */
export async function refundUnlockGuess(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => redis().decr(key)));
}
