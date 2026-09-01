-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'PHOTO',
    "category" TEXT NOT NULL DEFAULT 'other',
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaChecklistItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MediaChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "episodeId" TEXT,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_episodeId_category_idx" ON "MediaAsset"("episodeId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "MediaChecklistItem_key_key" ON "MediaChecklistItem"("key");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_idempotencyKey_key" ON "IntegrationEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationEvent_status_createdAt_idx" ON "IntegrationEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_episodeId_idx" ON "IntegrationEvent"("episodeId");
