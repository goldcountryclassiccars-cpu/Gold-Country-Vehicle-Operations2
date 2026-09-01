-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CommentVisibility" AS ENUM ('INTERNAL', 'VENDOR_VISIBLE');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETE', 'CANCELED');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'MINOR', 'MAJOR', 'SAFETY');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'DECLINED', 'IN_PROGRESS', 'QUALITY_CONTROL', 'COMPLETE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELED');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT,
    "taskId" TEXT,
    "workOrderId" TEXT,
    "inspectionId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "CommentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "summary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionFinding" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL DEFAULT 'MINOR',
    "description" TEXT,
    "recommendation" TEXT,
    "estimatedCost" DECIMAL(12,2),
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "departmentId" TEXT,
    "vendorPartyId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "estimatedCost" DECIMAL(12,2),
    "actualCost" DECIMAL(12,2),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT,
    "workOrderId" TEXT,
    "requestedById" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2),
    "reason" TEXT NOT NULL,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_episodeId_idx" ON "Task"("episodeId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_departmentId_status_idx" ON "Task"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Comment_episodeId_idx" ON "Comment"("episodeId");

-- CreateIndex
CREATE INDEX "Comment_taskId_idx" ON "Comment"("taskId");

-- CreateIndex
CREATE INDEX "Comment_workOrderId_idx" ON "Comment"("workOrderId");

-- CreateIndex
CREATE INDEX "Comment_inspectionId_idx" ON "Comment"("inspectionId");

-- CreateIndex
CREATE INDEX "Inspection_episodeId_idx" ON "Inspection"("episodeId");

-- CreateIndex
CREATE INDEX "Inspection_departmentId_status_idx" ON "Inspection"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Inspection_assigneeId_status_idx" ON "Inspection"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "InspectionFinding_inspectionId_idx" ON "InspectionFinding"("inspectionId");

-- CreateIndex
CREATE INDEX "WorkOrder_episodeId_idx" ON "WorkOrder"("episodeId");

-- CreateIndex
CREATE INDEX "WorkOrder_departmentId_status_idx" ON "WorkOrder"("departmentId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_assigneeId_status_idx" ON "WorkOrder"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_vendorPartyId_status_idx" ON "WorkOrder"("vendorPartyId", "status");

-- CreateIndex
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- CreateIndex
CREATE INDEX "Approval_workOrderId_idx" ON "Approval"("workOrderId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionFinding" ADD CONSTRAINT "InspectionFinding_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
