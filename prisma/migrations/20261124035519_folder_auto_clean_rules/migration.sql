-- CreateEnum
CREATE TYPE "CleanBasis" AS ENUM ('CREATED', 'MODIFIED');

-- CreateTable
CREATE TABLE "FolderRule" (
    "folderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "olderThanDays" INTEGER NOT NULL,
    "basis" "CleanBasis" NOT NULL DEFAULT 'MODIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolderRule_pkey" PRIMARY KEY ("folderId")
);

-- CreateIndex
CREATE INDEX "FolderRule_accountId_idx" ON "FolderRule"("accountId");

-- AddForeignKey
ALTER TABLE "FolderRule" ADD CONSTRAINT "FolderRule_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderRule" ADD CONSTRAINT "FolderRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
