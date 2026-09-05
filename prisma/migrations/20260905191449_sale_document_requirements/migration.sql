-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('GAS', 'DIESEL', 'ELECTRIC', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('BUYER_PICKUP', 'DEALER_DELIVERS', 'COMMON_CARRIER');

-- CreateEnum
CREATE TYPE "NegotiatedLanguage" AS ENUM ('EN', 'ES', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentTiming" AS ENUM ('INTAKE', 'SALE', 'POST_SALE');

-- CreateEnum
CREATE TYPE "RequirementState" AS ENUM ('REQUIRED', 'NOT_REQUIRED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Arrangement" ADD COLUMN     "titleState" TEXT;

-- AlterTable
ALTER TABLE "DocumentTemplate" ADD COLUMN     "appliesWhen" JSONB,
ADD COLUMN     "authority" TEXT,
ADD COLUMN     "buyerCopy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "eSign" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "physicalOriginal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retain" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "signers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "submitTo" TEXT,
ADD COLUMN     "timing" "DocumentTiming" NOT NULL DEFAULT 'SALE',
ADD COLUMN     "verifyWithCounsel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "worksheetFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SaleTransaction" ADD COLUMN     "cancellationWindowEndsAt" TIMESTAMP(3),
ADD COLUMN     "deliveredToBuyerAt" TIMESTAMP(3),
ADD COLUMN     "deliveryMethod" "DeliveryMethod",
ADD COLUMN     "deliveryState" TEXT,
ADD COLUMN     "lenderPartyId" TEXT,
ADD COLUMN     "manualAnswers" JSONB,
ADD COLUMN     "negotiatedLanguage" "NegotiatedLanguage",
ADD COLUMN     "odometerAtSale" INTEGER,
ADD COLUMN     "outsideLender" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reg51SerialNo" TEXT,
ADD COLUMN     "registrationState" TEXT,
ADD COLUMN     "saleDate" TIMESTAMP(3),
ADD COLUMN     "salesTaxCollected" DECIMAL(12,2),
ADD COLUMN     "tempPlateNo" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fuelType" "FuelType",
ADD COLUMN     "isMotorcycle" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SaleDocumentRequirement" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "state" "RequirementState" NOT NULL DEFAULT 'UNKNOWN',
    "reason" TEXT NOT NULL,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideState" "RequirementState",
    "overrideReason" TEXT,
    "overrideById" TEXT,
    "overrideAt" TIMESTAMP(3),
    "prefillAvailable" BOOLEAN NOT NULL DEFAULT false,
    "readyForSignature" BOOLEAN NOT NULL DEFAULT false,
    "buyerSigned" BOOLEAN NOT NULL DEFAULT false,
    "dealerSigned" BOOLEAN NOT NULL DEFAULT false,
    "consignorSigned" BOOLEAN NOT NULL DEFAULT false,
    "originalReceived" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "buyerCopyProvidedAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "lookupAt" TIMESTAMP(3),
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "documentInstanceId" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleDocumentRequirement_saleId_complete_idx" ON "SaleDocumentRequirement"("saleId", "complete");

-- CreateIndex
CREATE UNIQUE INDEX "SaleDocumentRequirement_saleId_templateId_key" ON "SaleDocumentRequirement"("saleId", "templateId");

-- AddForeignKey
ALTER TABLE "SaleDocumentRequirement" ADD CONSTRAINT "SaleDocumentRequirement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "SaleTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleDocumentRequirement" ADD CONSTRAINT "SaleDocumentRequirement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
