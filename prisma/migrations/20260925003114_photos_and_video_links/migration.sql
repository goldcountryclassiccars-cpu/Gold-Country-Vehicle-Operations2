-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "thumbFileId" TEXT,
ADD COLUMN     "webFileId" TEXT;

-- CreateTable
CREATE TABLE "VideoLink" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoLink_episodeId_idx" ON "VideoLink"("episodeId");
