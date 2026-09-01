-- CreateEnum
CREATE TYPE "TransportDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('QUOTE_REQUESTED', 'QUOTED', 'BOOKED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "TransportJob" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "saleId" TEXT,
    "direction" "TransportDirection" NOT NULL,
    "status" "TransportStatus" NOT NULL DEFAULT 'QUOTE_REQUESTED',
    "carrierPartyId" TEXT,
    "coordinatorId" TEXT,
    "quoteAmount" DECIMAL(12,2),
    "actualCost" DECIMAL(12,2),
    "pickupLocation" TEXT,
    "deliveryLocation" TEXT,
    "pickupAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "consignorPartyId" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "salePrice" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "expenseChargebacks" DECIMAL(12,2) NOT NULL,
    "netToConsignor" DECIMAL(12,2) NOT NULL,
    "dueBy" TIMESTAMP(3),
    "detail" JSONB NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransportJob_episodeId_idx" ON "TransportJob"("episodeId");

-- CreateIndex
CREATE INDEX "TransportJob_status_idx" ON "TransportJob"("status");

-- CreateIndex
CREATE INDEX "TransportJob_coordinatorId_status_idx" ON "TransportJob"("coordinatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_episodeId_key" ON "Settlement"("episodeId");

-- CreateIndex
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");
