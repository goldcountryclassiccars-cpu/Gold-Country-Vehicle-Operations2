-- CreateTable
CREATE TABLE "PartRequest" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderedAt" TIMESTAMP(3),
    "orderedById" TEXT,
    "orderedByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,

    CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartRequest_archivedAt_orderedAt_idx" ON "PartRequest"("archivedAt", "orderedAt");
