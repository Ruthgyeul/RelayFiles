-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "stripFailed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TrashedBytes" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "trashedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrashedBytes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrashedBytes_accountId_idx" ON "TrashedBytes"("accountId");

-- CreateIndex
CREATE INDEX "TrashedBytes_trashedAt_idx" ON "TrashedBytes"("trashedAt");

-- AddForeignKey
ALTER TABLE "TrashedBytes" ADD CONSTRAINT "TrashedBytes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
