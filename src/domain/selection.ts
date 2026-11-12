/** Shift-click range selection over the order a list is shown in. */

/**
 * The ids from `anchor` to `target`, both included, in list order. With no anchor (or one no
 * longer listed) the range is the target alone.
 */
export function rangeBetween(ids: readonly string[], anchor: string | null, target: string): string[] {
  const end = ids.indexOf(target);
  if (end < 0) return [];
  const start = anchor === null ? -1 : ids.indexOf(anchor);
  if (start < 0) return [target];
  const [from, to] = start <= end ? [start, end] : [end, start];
  return ids.slice(from, to + 1);
}
