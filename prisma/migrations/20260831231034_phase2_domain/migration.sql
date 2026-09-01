-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "MileageStatus" AS ENUM ('ACTUAL', 'EXEMPT', 'NOT_ACTUAL', 'TMU', 'BROKEN_ODOMETER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('VIN', 'SHORT_VIN', 'CHASSIS_NUMBER', 'SERIAL_NUMBER', 'ENGINE_NUMBER', 'BODY_NUMBER', 'COWL_TAG', 'OTHER', 'UNKNOWN_PENDING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('DEALER_PURCHASE', 'CONSIGNMENT', 'BROKERAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('EXPECTED', 'INBOUND_TRANSPORT', 'ON_SITE', 'DETAIL_AREA', 'MECHANICAL_AREA', 'BODY_SHOP', 'MEDIA_AREA', 'OFFSITE_VENDOR', 'AUTOMOTIVE_EVENT', 'TEST_DRIVE', 'TRANSPORT_STAGING', 'CARRIER_POSSESSION', 'DELIVERED', 'RETURNED_TO_CONSIGNOR');

-- CreateEnum
CREATE TYPE "ReconditioningStatus" AS ENUM ('NOT_ASSESSED', 'INSPECTION_SCHEDULED', 'INSPECTION_IN_PROGRESS', 'AWAITING_ESTIMATE', 'AWAITING_APPROVAL', 'AWAITING_CONSIGNOR_APPROVAL', 'AWAITING_PARTS', 'WORK_IN_PROGRESS', 'QUALITY_CONTROL', 'COMPLETE', 'WORK_DECLINED', 'NO_WORK_REQUIRED');

-- CreateEnum
CREATE TYPE "MarketingStatus" AS ENUM ('NOT_READY', 'MEDIA_PENDING', 'MEDIA_IN_PROGRESS', 'LISTING_PACKAGE_INCOMPLETE', 'READY_FOR_LISTING', 'SUBMITTED_TO_LISTING_SYSTEM', 'LIVE', 'PAUSED', 'WITHDRAWN', 'MARKED_SOLD');

-- CreateEnum
CREATE TYPE "SalesStatus" AS ENUM ('AVAILABLE', 'INQUIRY_ACTIVITY', 'HOLD', 'DEPOSIT_REQUESTED', 'DEPOSIT_RECEIVED', 'CONTRACTED', 'FUNDS_PENDING', 'FUNDED', 'READY_FOR_RELEASE', 'RELEASED', 'DELIVERED', 'CANCELED', 'UNWOUND');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('NOT_STARTED', 'MISSING_SELLER_DOCUMENTS', 'MISSING_BUYER_DATA', 'READY_TO_GENERATE', 'GENERATED', 'SENT', 'PARTIALLY_SIGNED', 'ESIGN_COMPLETE', 'ORIGINALS_PENDING', 'COMPLETE', 'FILED');

-- CreateEnum
CREATE TYPE "FinancialCloseStatus" AS ENUM ('ESTIMATING', 'EXPENSES_INCOMPLETE', 'BUYER_FUNDS_PENDING', 'BUYER_FUNDED', 'CONSIGNOR_PAYABLE', 'PAYOUT_APPROVAL_PENDING', 'PAYOUT_COMPLETE', 'FINAL_RECONCILIATION_PENDING', 'FINANCIALLY_CLOSED');

-- CreateEnum
CREATE TYPE "RelatedItemType" AS ENUM ('KEYS', 'TITLE', 'REGISTRATION', 'SERVICE_RECORDS', 'MANUALS', 'TOOL_KIT', 'SPARE_PARTS', 'EXTRA_WHEELS', 'REMOVABLE_TOP', 'CAR_COVER', 'OTHER');

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sensitivity" TEXT,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "organization" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'US',
    "notes" TEXT,
    "isVendor" BOOLEAN NOT NULL DEFAULT false,
    "isCarrier" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "year" INTEGER,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "bodyStyle" TEXT,
    "exteriorColor" TEXT,
    "interiorColor" TEXT,
    "engineDescription" TEXT,
    "transmission" TEXT,
    "drivetrain" TEXT,
    "mileage" INTEGER,
    "mileageStatus" "MileageStatus" NOT NULL DEFAULT 'UNKNOWN',
    "titleBrand" TEXT,
    "buildDate" TEXT,
    "matchingNumbers" TEXT,
    "originalityNotes" TEXT,
    "modifications" TEXT,
    "restorationHistory" TEXT,
    "provenance" TEXT,
    "generalDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleIdentifier" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "photoFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AcquisitionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryEpisode" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "stockNumber" TEXT NOT NULL,
    "dealType" "DealType" NOT NULL,
    "acquisitionSourceId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "expectedArrivalAt" TIMESTAMP(3),
    "actualArrivalAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "currentLocationId" TEXT,
    "custodyStatus" "CustodyStatus" NOT NULL DEFAULT 'EXPECTED',
    "reconditioningStatus" "ReconditioningStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
    "marketingStatus" "MarketingStatus" NOT NULL DEFAULT 'NOT_READY',
    "salesStatus" "SalesStatus" NOT NULL DEFAULT 'AVAILABLE',
    "documentStatus" "DocStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "financialCloseStatus" "FinancialCloseStatus" NOT NULL DEFAULT 'ESTIMATING',
    "salespersonId" TEXT,
    "operationsOwnerId" TEXT,
    "askingPrice" DECIMAL(12,2),
    "priceReviewAt" TIMESTAMP(3),
    "firstListedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusChange" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arrangement" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "sellerPartyId" TEXT,
    "purchasePrice" DECIMAL(12,2),
    "guaranteedConsignorNet" DECIMAL(12,2),
    "commissionStructure" JSONB,
    "reserveAmount" DECIMAL(12,2),
    "minimumAcceptablePrice" DECIMAL(12,2),
    "askingPriceAuthority" TEXT,
    "priceReductionAuthority" TEXT,
    "agreementStartAt" TIMESTAMP(3),
    "agreementExpiresAt" TIMESTAMP(3),
    "renewalTerms" TEXT,
    "expenseResponsibility" TEXT,
    "insuranceResponsibility" TEXT,
    "titleStatus" TEXT,
    "lienStatus" TEXT,
    "lienholderPartyId" TEXT,
    "ownerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arrangement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleLocationEvent" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT NOT NULL,
    "movedById" TEXT,
    "reason" TEXT,
    "photoFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleLocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatedItem" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "type" "RelatedItemType" NOT NULL,
    "description" TEXT,
    "currentLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelatedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatedItemLocationEvent" (
    "id" TEXT NOT NULL,
    "relatedItemId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT NOT NULL,
    "movedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelatedItemLocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeRecord" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "arrivalMethod" TEXT,
    "carrierPartyId" TEXT,
    "odometerReading" INTEGER,
    "mileageStatus" "MileageStatus",
    "identityVerified" BOOLEAN,
    "starts" BOOLEAN,
    "runs" BOOLEAN,
    "drives" BOOLEAN,
    "stops" BOOLEAN,
    "fuelLevel" TEXT,
    "exteriorDamageNotes" TEXT,
    "interiorDamageNotes" TEXT,
    "glassCondition" TEXT,
    "tireCondition" TEXT,
    "transportDamageNotes" TEXT,
    "sellerReportedIssues" TEXT,
    "keysReceived" INTEGER,
    "documentsReceived" TEXT,
    "accessoriesReceived" TEXT,
    "safetyConcerns" TEXT,
    "initialLocationId" TEXT,
    "notes" TEXT,
    "draftData" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "VehicleIdentifier_vehicleId_idx" ON "VehicleIdentifier"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleIdentifier_value_idx" ON "VehicleIdentifier"("value");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionSource_key_key" ON "AcquisitionSource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEpisode_stockNumber_key" ON "InventoryEpisode"("stockNumber");

-- CreateIndex
CREATE INDEX "InventoryEpisode_vehicleId_idx" ON "InventoryEpisode"("vehicleId");

-- CreateIndex
CREATE INDEX "InventoryEpisode_active_idx" ON "InventoryEpisode"("active");

-- CreateIndex
CREATE INDEX "InventoryEpisode_salesStatus_idx" ON "InventoryEpisode"("salesStatus");

-- CreateIndex
CREATE INDEX "StatusChange_episodeId_dimension_idx" ON "StatusChange"("episodeId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "Arrangement_episodeId_key" ON "Arrangement"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_key_key" ON "Location"("key");

-- CreateIndex
CREATE INDEX "VehicleLocationEvent_episodeId_idx" ON "VehicleLocationEvent"("episodeId");

-- CreateIndex
CREATE INDEX "RelatedItem_episodeId_idx" ON "RelatedItem"("episodeId");

-- CreateIndex
CREATE INDEX "RelatedItemLocationEvent_relatedItemId_idx" ON "RelatedItemLocationEvent"("relatedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRecord_episodeId_key" ON "IntakeRecord"("episodeId");

-- AddForeignKey
ALTER TABLE "VehicleIdentifier" ADD CONSTRAINT "VehicleIdentifier_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEpisode" ADD CONSTRAINT "InventoryEpisode_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrangement" ADD CONSTRAINT "Arrangement_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "InventoryEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRecord" ADD CONSTRAINT "IntakeRecord_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "InventoryEpisode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
