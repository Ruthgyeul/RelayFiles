-- AlterTable
ALTER TABLE "StorageVolume" ADD COLUMN     "resumeStatus" "VolumeStatus";

-- AlterTable
ALTER TABLE "TrashedBytes" ADD COLUMN     "volumeId" TEXT;
