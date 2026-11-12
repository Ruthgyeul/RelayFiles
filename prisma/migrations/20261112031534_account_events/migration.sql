-- CreateTable
CREATE TABLE "AccountEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "os" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "ipMasked" TEXT NOT NULL,
    "country" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountEvent_accountId_at_idx" ON "AccountEvent"("accountId", "at");

-- CreateIndex
CREATE INDEX "AccountEvent_at_idx" ON "AccountEvent"("at");

-- AddForeignKey
ALTER TABLE "AccountEvent" ADD CONSTRAINT "AccountEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
