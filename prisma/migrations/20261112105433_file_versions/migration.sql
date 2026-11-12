-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT,
    "mime" TEXT,
    "modifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileVersion_nodeId_createdAt_idx" ON "FileVersion"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "FileVersion_accountId_idx" ON "FileVersion"("accountId");

-- CreateIndex
CREATE INDEX "FileVersion_createdAt_idx" ON "FileVersion"("createdAt");

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
