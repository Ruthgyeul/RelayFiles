-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "maxUses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "uses" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Invite_expiresAt_idx" ON "Invite"("expiresAt");

-- Codes used before this release created their one account.
UPDATE "Invite" SET "uses" = 1 WHERE "usedAt" IS NOT NULL;
