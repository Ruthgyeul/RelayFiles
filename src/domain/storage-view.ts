/** "Storage" page: the bars for what the top of the root holds. */

const PERCENT = 100;

export interface StorageEntry {
  id: string;
  name: string;
  folder: boolean;
  bytes: bigint;
}

export interface StorageBar {
  /** Null for the "Other" bar. */
  id: string | null;
  name: string;
  folder: boolean;
  bytes: string;
  /** Share of `total`, 0–100. */
  percent: number;
  /** Items the "Other" bar adds up (1 for the rest). */
  count: number;
}

const share = (bytes: bigint, total: bigint) => (total > 0n ? Number((bytes * BigInt(PERCENT * PERCENT)) / total) / PERCENT : 0);

/**
 * Largest first; with more than `maxBars` entries the smallest ones become one "Other" bar so
 * at most `maxBars` are shown. Empty items (0 bytes) are left out.
 */
export function storageBars(entries: readonly StorageEntry[], total: bigint, maxBars: number): StorageBar[] {
  const sized = entries.filter((entry) => entry.bytes > 0n).sort((a, b) => (b.bytes > a.bytes ? 1 : b.bytes < a.bytes ? -1 : a.name.localeCompare(b.name)));
  const bar = (entry: StorageEntry): StorageBar => ({ id: entry.id, name: entry.name, folder: entry.folder, bytes: entry.bytes.toString(), percent: share(entry.bytes, total), count: 1 });
  if (sized.length <= maxBars) return sized.map(bar);
  const shown = sized.slice(0, maxBars - 1);
  const rest = sized.slice(maxBars - 1);
  const restBytes = rest.reduce((sum, entry) => sum + entry.bytes, 0n);
  return [...shown.map(bar), { id: null, name: "Other", folder: false, bytes: restBytes.toString(), percent: share(restBytes, total), count: rest.length }];
}
