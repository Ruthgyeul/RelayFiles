import "server-only";
import type { DataMigrationStep } from "./data-migrations";

/**
 * Every data migration, oldest first. Add new ones at the end in their own file under
 * src/server/migrations/ (one per change); never edit or remove one that has run.
 */
export const DATA_MIGRATIONS: readonly DataMigrationStep[] = [];
