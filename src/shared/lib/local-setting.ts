/**
 * Small per-device UI preferences in localStorage, stored as `{ v, data }` so a format
 * change can migrate or drop old values (docs/plan.md §13.8 ⑦). Storage can be missing
 * or blocked (private mode), so every access is guarded.
 */
const VERSION = 1;

export function readLocalSetting<T>(key: string, isValid: (value: unknown) => value is T): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { v?: unknown; data?: unknown };
    return parsed.v === VERSION && isValid(parsed.data) ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalSetting(key: string, data: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: VERSION, data }));
  } catch {
    // Preferences are a convenience; ignore blocked storage.
  }
}

export function readSessionValue(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionValue(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore blocked storage.
  }
}
