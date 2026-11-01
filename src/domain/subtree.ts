/** A row of a folder tree: what is needed to place it below its top. */
export interface TreeRow {
  id: string;
  parentId: string | null;
  name: string;
}

/**
 * Every row of a tree read from `topId` down, with its folder names below the top (the top
 * itself: []). Depth first, parents before children, siblings in the order given; rows whose
 * parent is not in the tree are left out. Used to lay a subtree out on disk or in a zip.
 */
export function subtreePaths<T extends TreeRow>(rows: readonly T[], topId: string): { row: T; segments: string[] }[] {
  const top = rows.find((row) => row.id === topId);
  if (!top) return [];
  const children = new Map<string, T[]>();
  for (const row of rows) {
    if (row.id === topId || row.parentId === null) continue;
    const siblings = children.get(row.parentId);
    if (siblings) siblings.push(row);
    else children.set(row.parentId, [row]);
  }
  const result: { row: T; segments: string[] }[] = [];
  const stack: { row: T; segments: string[] }[] = [{ row: top, segments: [] }];
  for (let next = stack.pop(); next; next = stack.pop()) {
    result.push(next);
    const below = children.get(next.row.id) ?? [];
    // Reversed onto the stack, so siblings come out in their given order.
    for (let index = below.length - 1; index >= 0; index--) stack.push({ row: below[index]!, segments: [...next.segments, below[index]!.name] });
  }
  return result;
}
