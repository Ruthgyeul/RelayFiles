-- CreateEnum
CREATE TYPE "StripMode" AS ENUM ('SENSITIVE', 'ALL');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "derivedMode" "StripMode";
