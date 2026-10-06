import { readSessionValue, writeSessionValue } from "@/shared/lib/local-setting";

/**
 * The anonymous account created automatically for this visit (design `autoAcct`). It is
 * remembered per browser tab so the "You're signed in as …" banner survives reloads until
 * dismissed. Exposed as an external store for useSyncExternalStore.
 */
const KEY = "relay.autoAccount";
const listeners = new Set<() => void>();

export const autoAccountStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): string | null => readSessionValue(KEY),
  getServer: (): string | null => null,
  set(accountId: string | null) {
    writeSessionValue(KEY, accountId);
    for (const listener of listeners) listener();
  },
};
