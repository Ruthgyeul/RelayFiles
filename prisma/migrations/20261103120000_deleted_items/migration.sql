-- CreateTable
CREATE TABLE "DeletedItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "volumeId" TEXT NOT NULL,
    "trashPath" TEXT NOT NULL,
    "trashedBytesId" TEXT,
    "name" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "kind" "FileKind",
    "size" BIGINT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "originalParentId" TEXT,
    "originalPath" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nodes" JSONB NOT NULL,

    CONSTRAINT "DeletedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletedItem_accountId_deletedAt_idx" ON "DeletedItem"("accountId", "deletedAt");

-- CreateIndex
CREATE INDEX "DeletedItem_deletedAt_idx" ON "DeletedItem"("deletedAt");

-- AddForeignKey
ALTER TABLE "DeletedItem" ADD CONSTRAINT "DeletedItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
