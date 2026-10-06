-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "VolumeStatus" AS ENUM ('ACTIVE', 'READONLY', 'DRAINING', 'OFFLINE');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('FOLDER', 'FILE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('VIDEO', 'AUDIO', 'IMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('INHERIT', 'PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "Access" AS ENUM ('BOTH', 'STREAM');

-- CreateEnum
CREATE TYPE "LinkEventKind" AS ENUM ('OPEN', 'PLAY', 'VIEW', 'DOWNLOAD', 'RESET');

-- CreateEnum
CREATE TYPE "SignupMode" AS ENUM ('OPEN', 'INVITE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AnnouncementLevel" AS ENUM ('INFO', 'WARN', 'MAINT');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MAJOR', 'MAINT');

-- CreateEnum
CREATE TYPE "HealthLevel" AS ENUM ('OK', 'WARN', 'DOWN');

-- CreateTable
CREATE TABLE "StorageVolume" (
    "id" TEXT NOT NULL,
    "driver" "StorageDriver" NOT NULL DEFAULT 'LOCAL',
    "mountPath" TEXT NOT NULL,
    "status" "VolumeStatus" NOT NULL DEFAULT 'ACTIVE',
    "layoutVersion" INTEGER NOT NULL DEFAULT 1,
    "reservePct" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenLookup" TEXT NOT NULL,
    "tokenEnc" BYTEA NOT NULL,
    "color" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "neverExpire" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "quotaBytes" BIGINT,
    "stripMetadataOnShare" BOOLEAN NOT NULL DEFAULT true,
    "migrating" BOOLEAN NOT NULL DEFAULT false,
    "volumeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "ipMasked" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "NodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FileKind",
    "mime" TEXT,
    "size" BIGINT NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "hasThumb" BOOLEAN NOT NULL DEFAULT false,
    "hasDerived" BOOLEAN NOT NULL DEFAULT false,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "linkId" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'INHERIT',
    "expiryLabel" TEXT NOT NULL DEFAULT 'Never',
    "expAt" TIMESTAMP(3),
    "burn" BOOLEAN NOT NULL DEFAULT false,
    "downloadLimit" INTEGER,
    "passwordHash" TEXT,
    "access" "Access" NOT NULL DEFAULT 'BOTH',
    "note" TEXT NOT NULL DEFAULT '',
    "dlPaused" BOOLEAN NOT NULL DEFAULT false,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkEvent" (
    "id" BIGSERIAL NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" "LinkEventKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT '',
    "ipMasked" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficDaily" (
    "accountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "TrafficDaily_pkey" PRIMARY KEY ("accountId","day")
);

-- CreateTable
CREATE TABLE "ServerConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "signupMode" "SignupMode" NOT NULL DEFAULT 'OPEN',
    "theme" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByName" TEXT,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "level" "AnnouncementLevel" NOT NULL DEFAULT 'INFO',
    "live" BOOLEAN NOT NULL DEFAULT true,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MINOR',
    "date" TIMESTAMP(3) NOT NULL,
    "duration" TEXT NOT NULL DEFAULT '',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthSample" (
    "id" BIGSERIAL NOT NULL,
    "component" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "ms" INTEGER,

    CONSTRAINT "HealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthHourly" (
    "component" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "avgMs" INTEGER,
    "p95Ms" INTEGER,

    CONSTRAINT "HealthHourly_pkey" PRIMARY KEY ("component","hour")
);

-- CreateTable
CREATE TABLE "HealthDaily" (
    "component" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "level" "HealthLevel" NOT NULL,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HealthDaily_pkey" PRIMARY KEY ("component","day")
);

-- CreateTable
CREATE TABLE "DataMigration" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "cursor" TEXT,

    CONSTRAINT "DataMigration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_name_key" ON "Account"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tokenLookup_key" ON "Account"("tokenLookup");

-- CreateIndex
CREATE INDEX "Account_volumeId_idx" ON "Account"("volumeId");

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Node_linkId_key" ON "Node"("linkId");

-- CreateIndex
CREATE INDEX "Node_accountId_parentId_idx" ON "Node"("accountId", "parentId");

-- CreateIndex
CREATE INDEX "Node_accountId_type_idx" ON "Node"("accountId", "type");

-- CreateIndex
CREATE INDEX "Node_expAt_idx" ON "Node"("expAt");

-- CreateIndex
CREATE INDEX "Node_tags_idx" ON "Node" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "Node_parentId_name_key" ON "Node"("parentId", "name");

-- CreateIndex
CREATE INDEX "LinkEvent_nodeId_at_idx" ON "LinkEvent"("nodeId", "at");

-- CreateIndex
CREATE INDEX "HealthSample_component_at_idx" ON "HealthSample"("component", "at");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "StorageVolume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkEvent" ADD CONSTRAINT "LinkEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficDaily" ADD CONSTRAINT "TrafficDaily_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
