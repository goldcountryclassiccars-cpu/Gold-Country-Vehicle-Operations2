-- AlterTable
ALTER TABLE "DocumentTemplate" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedFileId" TEXT,
ADD COLUMN     "approvedVersionNote" TEXT;
