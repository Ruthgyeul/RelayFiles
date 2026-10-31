-- CreateTable
CREATE TABLE "BackupCheck" (
    "id" BIGSERIAL NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "dumpName" TEXT,
    "dumpAt" TIMESTAMP(3),
    "restoreMs" INTEGER,
    "fsckDifferences" INTEGER,
    "problems" TEXT[],

    CONSTRAINT "BackupCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupCheck_checkedAt_idx" ON "BackupCheck"("checkedAt");
