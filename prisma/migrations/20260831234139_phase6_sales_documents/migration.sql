-- CreateEnum
CREATE TYPE "SaleTxStatus" AS ENUM ('DRAFT', 'DEPOSIT_REQUESTED', 'DEPOSIT_RECEIVED', 'CONTRACTED', 'FUNDS_PENDING', 'FUNDED', 'RELEASED', 'DELIVERED', 'COMPLETE', 'CANCELED', 'UNWOUND');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('DEPOSIT', 'DOWN_PAYMENT', 'FINAL', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('WIRE', 'CHECK', 'CASH', 'CARD', 'FINANCING', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('EXPECTED', 'RECEIVED', 'CLEARED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('GENERATED', 'SENT', 'PARTIALLY_SIGNED', 'SIGNED', 'VOIDED', 'FILED');

-- CreateTable
CREATE TABLE "SaleTransaction" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "buyerPartyId" TEXT NOT NULL,
    "coBuyerPartyId" TEXT,
    "salespersonId" TEXT,
    "status" "SaleTxStatus" NOT NULL DEFAULT 'DRAFT',
    "agreedPrice" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2),
    "notes" TEXT,
    "contractedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'EXPECTED',
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "requiresWetSignature" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentInstance" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "saleId" TEXT,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "DocumentStatus" NOT NULL DEFAULT 'GENERATED',
    "fileId" TEXT NOT NULL,
    "envelopeExternalId" TEXT,
    "generatedById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleTransaction_episodeId_status_idx" ON "SaleTransaction"("episodeId", "status");

-- CreateIndex
CREATE INDEX "SaleTransaction_salespersonId_idx" ON "SaleTransaction"("salespersonId");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_key_key" ON "DocumentTemplate"("key");

-- CreateIndex
CREATE INDEX "DocumentInstance_episodeId_idx" ON "DocumentInstance"("episodeId");

-- CreateIndex
CREATE INDEX "DocumentInstance_saleId_idx" ON "DocumentInstance"("saleId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "SaleTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "SaleTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
