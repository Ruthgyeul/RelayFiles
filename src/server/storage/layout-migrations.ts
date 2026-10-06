import "server-only";

/**
 * Changes to the on-disk layout of a volume (docs/plan.md §13.8 ②), applied in order by
 * `npm run storage:migrate`. Each step moves a volume from `from` to `to` and must be safe
 * to run again after an interruption (prefer renames; check before moving).
 * Layout 1 (src/server/storage/layout.ts) is the first one, so there are no steps yet.
 */
export interface LayoutMigration {
  from: number;
  to: number;
  description: string;
  up(root: string): Promise<void>;
}

export const LAYOUT_MIGRATIONS: readonly LayoutMigration[] = [];

/** The steps that take a volume from `current` to `target`, or an error if there is a gap. */
export function layoutPlan(current: number, target: number, migrations: readonly LayoutMigration[] = LAYOUT_MIGRATIONS): LayoutMigration[] {
  if (current > target) throw new Error(`Volume layout ${current} is newer than this release (${target}); update the app instead.`);
  const plan: LayoutMigration[] = [];
  for (let version = current; version < target; ) {
    const step = migrations.find((migration) => migration.from === version);
    if (!step) throw new Error(`No storage migration from layout ${version}.`);
    plan.push(step);
    version = step.to;
  }
  return plan;
}
