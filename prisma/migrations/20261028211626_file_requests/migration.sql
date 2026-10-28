-- CreateTable
CREATE TABLE "FileRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxFiles" INTEGER,
    "maxBytes" BIGINT,
    "filesReceived" INTEGER NOT NULL DEFAULT 0,
    "bytesReceived" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileRequest_accountId_idx" ON "FileRequest"("accountId");

-- CreateIndex
CREATE INDEX "FileRequest_folderId_idx" ON "FileRequest"("folderId");

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
