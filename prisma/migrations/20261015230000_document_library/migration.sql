-- Document Library: journey stages, standalone sends, consignor envelopes.
-- Additive only. down.sql reverses it.

-- CreateEnum
CREATE TYPE "JourneyStage" AS ENUM ('LEAD', 'HOLD_DEPOSIT', 'CONTRACT', 'CLOSING', 'DELIVERY', 'CONSIGN_INTAKE', 'CONSIGN_SETTLEMENT');

-- CreateEnum
CREATE TYPE "DocumentSentVia" AS ENUM ('ESIGN', 'EMAIL_PDF', 'PRINTED');

-- AlterTable
ALTER TABLE "DocumentTemplate"
  ADD COLUMN "journeyStage" "JourneyStage" NOT NULL DEFAULT 'CONTRACT',
  ADD COLUMN "sendableStandalone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DocumentInstance"
  ADD COLUMN "partyId" TEXT,
  ADD COLUMN "sentVia" "DocumentSentVia";

-- CreateIndex
CREATE INDEX "DocumentInstance_partyId_idx" ON "DocumentInstance"("partyId");

-- AlterTable
ALTER TABLE "SignatureEnvelope"
  ALTER COLUMN "saleId" DROP NOT NULL,
  ADD COLUMN "episodeId" TEXT,
  ADD COLUMN "partyId" TEXT;

-- Existing envelopes: carry the episode over so nothing is left without one.
UPDATE "SignatureEnvelope" e SET "episodeId" = s."episodeId"
  FROM "SaleTransaction" s WHERE s."id" = e."saleId" AND e."episodeId" IS NULL;

-- CreateIndex
CREATE INDEX "SignatureEnvelope_episodeId_idx" ON "SignatureEnvelope"("episodeId");
