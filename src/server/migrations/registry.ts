import "server-only";
import { backfillModifiedAt } from "./20261101-backfill-modified-at";
import { backfillSha256 } from "./20261101-backfill-sha256";
import type { DataMigrationStep } from "./data-migrations";

/**
 * Every data migration, oldest first. Add new ones at the end in their own file under
 * src/server/migrations/ (one per change); never edit or remove one that has run.
 */
export const DATA_MIGRATIONS: readonly DataMigrationStep[] = [backfillModifiedAt, backfillSha256];
