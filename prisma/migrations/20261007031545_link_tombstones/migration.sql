-- CreateTable
CREATE TABLE "LinkTombstone" (
    "linkId" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkTombstone_pkey" PRIMARY KEY ("linkId")
);

-- CreateIndex
CREATE INDEX "LinkTombstone_endedAt_idx" ON "LinkTombstone"("endedAt");
