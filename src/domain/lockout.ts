/**
 * Sign-in lockout ladder from the design prototype (`addToken`): every `maxAttempts`
 * failures lock sign-in, for 30 s, then 120 s, then 600 s for every later lockout.
 */

export interface LockoutPolicy {
  maxAttempts: number;
  /** Lock lengths in seconds for the 1st, 2nd, … lockout; the last value repeats. */
  lockSeconds: readonly number[];
}

/** Seconds to lock after the `failures`-th failure, or 0 when this failure does not lock. */
export function lockSecondsAfter(failures: number, policy: LockoutPolicy): number {
  if (failures <= 0 || failures % policy.maxAttempts !== 0) return 0;
  const lockIndex = failures / policy.maxAttempts - 1;
  const ladder = policy.lockSeconds;
  return ladder[Math.min(lockIndex, ladder.length - 1)] ?? 0;
}

/** Attempts left before the next lockout. */
export function attemptsLeft(failures: number, policy: LockoutPolicy): number {
  return policy.maxAttempts - (failures % policy.maxAttempts);
}

/** Message shown after a failed token sign-in (design wording). */
export function failureMessage(token: string, failures: number, policy: LockoutPolicy, tokenLength: number): string {
  const reason = token.length !== tokenLength ? `Tokens are ${tokenLength} characters.` : "No account matches this token.";
  return `${reason} ${attemptsLeft(failures, policy)} attempts left before a lockout.`;
}
