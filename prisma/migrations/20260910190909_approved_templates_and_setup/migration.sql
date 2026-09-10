-- CreateTable
CREATE TABLE "DocumentSetupItem" (
    "key" TEXT NOT NULL,
    "provided" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "providedById" TEXT,
    "providedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSetupItem_pkey" PRIMARY KEY ("key")
);
