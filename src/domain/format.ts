/**
 * Display formatting ported from the design prototype. Output strings must match the
 * design exactly, so each function mirrors its prototype counterpart.
 */

/** Clock time "m:ss" or "h:mm:ss" (prototype `fmtT`), floor of the seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
}

/** Countdown text: rounds up so "0:00" only shows once the wait is over (prototype `lockText`). */
export function formatCountdown(seconds: number): string {
  return formatClock(Math.ceil(Math.max(0, seconds)));
}
