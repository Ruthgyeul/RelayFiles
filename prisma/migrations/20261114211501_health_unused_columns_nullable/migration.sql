-- Expand step: nothing writes HealthDaily.level (or HealthHourly.p95Ms, already nullable) any more.
-- The next release drops both columns and the HealthLevel type.
-- AlterTable
ALTER TABLE "HealthDaily" ALTER COLUMN "level" DROP NOT NULL;
