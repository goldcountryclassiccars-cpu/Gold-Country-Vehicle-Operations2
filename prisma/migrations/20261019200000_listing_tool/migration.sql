-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('INTAKE', 'LISTING');

-- CreateEnum
CREATE TYPE "ListingPriceDisplay" AS ENUM ('SHOW', 'CALL_FOR_PRICE');

-- CreateEnum
CREATE TYPE "ListingChannelMethod" AS ENUM ('FEED', 'MANUAL');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('QUEUED', 'LIVE', 'REMOVING', 'OFF');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "largeFileId" TEXT,
ADD COLUMN     "purpose" "MediaPurpose" NOT NULL DEFAULT 'INTAKE';

-- AlterTable
ALTER TABLE "VideoLink" ADD COLUMN     "purpose" "MediaPurpose" NOT NULL DEFAULT 'INTAKE',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headline" TEXT,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "equipment" TEXT,
    "history" TEXT,
    "condition" TEXT,
    "documentation" TEXT,
    "priceDisplay" "ListingPriceDisplay" NOT NULL DEFAULT 'SHOW',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingChannel" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" "ListingChannelMethod" NOT NULL DEFAULT 'MANUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "feedToken" TEXT NOT NULL,
    "lastFetchAt" TIMESTAMP(3),
    "lastFetchFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingChannel_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ListingPublication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "channelKey" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "deliveredVersion" INTEGER,
    "externalUrl" TEXT,
    "queuedAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "lastDeliveredAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Listing_episodeId_key" ON "Listing"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingChannel_feedToken_key" ON "ListingChannel"("feedToken");

-- CreateIndex
CREATE INDEX "ListingPublication_channelKey_status_idx" ON "ListingPublication"("channelKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ListingPublication_listingId_channelKey_key" ON "ListingPublication"("listingId", "channelKey");

-- CreateIndex
CREATE INDEX "MediaAsset_episodeId_purpose_kind_idx" ON "MediaAsset"("episodeId", "purpose", "kind");

-- AddForeignKey
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

