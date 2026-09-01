-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('ESTIMATED', 'SUBMITTED', 'APPROVED', 'DECLINED', 'COMMITTED', 'INCURRED', 'PAID', 'REIMBURSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseResponsibility" AS ENUM ('DEALERSHIP', 'CONSIGNOR', 'BUYER_PASS_THROUGH', 'SHARED', 'REIMBURSABLE', 'PENDING');

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseEntry" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "vendorPartyId" TEXT,
    "description" TEXT NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'ESTIMATED',
    "responsibility" "ExpenseResponsibility" NOT NULL DEFAULT 'DEALERSHIP',
    "estimatedAmount" DECIMAL(12,2),
    "approvedAmount" DECIMAL(12,2),
    "committedAmount" DECIMAL(12,2),
    "actualAmount" DECIMAL(12,2),
    "paidAt" TIMESTAMP(3),
    "receiptFileId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitSnapshot" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "revenue" DECIMAL(12,2),
    "acquisitionCost" DECIMAL(12,2),
    "dealershipExpenses" DECIMAL(12,2) NOT NULL,
    "consignorExpenses" DECIMAL(12,2) NOT NULL,
    "otherExpenses" DECIMAL(12,2) NOT NULL,
    "grossProfit" DECIMAL(12,2),
    "netProfit" DECIMAL(12,2),
    "detail" JSONB NOT NULL,
    "computedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_key_key" ON "ExpenseCategory"("key");

-- CreateIndex
CREATE INDEX "ExpenseEntry_episodeId_status_idx" ON "ExpenseEntry"("episodeId", "status");

-- CreateIndex
CREATE INDEX "ExpenseEntry_workOrderId_idx" ON "ExpenseEntry"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitSnapshot_episodeId_key" ON "ProfitSnapshot"("episodeId");

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
