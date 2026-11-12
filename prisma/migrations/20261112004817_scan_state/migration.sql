-- CreateEnum
CREATE TYPE "ScanState" AS ENUM ('NONE', 'PENDING', 'CLEAN', 'FAILED');

-- CreateEnum
CREATE TYPE "DeleteReason" AS ENUM ('DELETED', 'INFECTED');

-- AlterTable
ALTER TABLE "DeletedItem" ADD COLUMN     "malware" TEXT,
ADD COLUMN     "reason" "DeleteReason" NOT NULL DEFAULT 'DELETED';

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "scanState" "ScanState" NOT NULL DEFAULT 'NONE';
