import "server-only";
import { logger } from "../logger";

/** Collects compensating actions for filesystem changes made inside a DB transaction. */
export class UndoStack {
  private readonly actions: Array<{ label: string; run: () => Promise<void> }> = [];

  /** Registers how to undo a filesystem change that just succeeded. */
  push(label: string, run: () => Promise<void>): void {
    this.actions.push({ label, run });
  }

  /** Runs undo actions newest first; failures are logged and left for the reconcile job. */
  async rollback(): Promise<void> {
    for (const action of this.actions.reverse()) {
      try {
        await action.run();
      } catch (error) {
        logger.error("storage rollback step failed", { step: action.label, error });
      }
    }
  }
}

/** Minimal shape of a Prisma client's interactive transaction API. */
export interface Transactional<Tx> {
  $transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
}

/**
 * Keeps PostgreSQL (the index) and the disk (the source of truth) consistent
 * (docs/plan.md §13.5). The callback performs DB writes through `tx` and filesystem
 * changes, registering an undo for each filesystem change. If the callback throws or the
 * commit fails, the DB rolls back and the undo actions restore the disk.
 */
export async function withStorageTransaction<Tx, R>(db: Transactional<Tx>, fn: (tx: Tx, undo: UndoStack) => Promise<R>): Promise<R> {
  const undo = new UndoStack();
  try {
    return await db.$transaction((tx) => fn(tx, undo));
  } catch (error) {
    await undo.rollback();
    throw error;
  }
}
