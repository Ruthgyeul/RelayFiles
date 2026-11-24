-- CreateTable
CREATE TABLE "ShareCollection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "expiryLabel" TEXT NOT NULL DEFAULT 'Never',
    "expAt" TIMESTAMP(3),
    "burn" BOOLEAN NOT NULL DEFAULT false,
    "downloadLimit" INTEGER,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "passwordHash" TEXT,
    "access" "Access" NOT NULL DEFAULT 'BOTH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ShareCollectionItem_pkey" PRIMARY KEY ("collectionId","nodeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareCollection_linkId_key" ON "ShareCollection"("linkId");

-- CreateIndex
CREATE INDEX "ShareCollection_accountId_createdAt_idx" ON "ShareCollection"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareCollection_expAt_idx" ON "ShareCollection"("expAt");

-- CreateIndex
CREATE INDEX "ShareCollectionItem_nodeId_idx" ON "ShareCollectionItem"("nodeId");

-- AddForeignKey
ALTER TABLE "ShareCollection" ADD CONSTRAINT "ShareCollection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareCollectionItem" ADD CONSTRAINT "ShareCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "ShareCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareCollectionItem" ADD CONSTRAINT "ShareCollectionItem_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
