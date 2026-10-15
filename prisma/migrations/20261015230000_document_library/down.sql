DROP INDEX IF EXISTS "SignatureEnvelope_episodeId_idx";
DELETE FROM "SignatureEnvelope" WHERE "saleId" IS NULL;
ALTER TABLE "SignatureEnvelope" DROP COLUMN "partyId", DROP COLUMN "episodeId", ALTER COLUMN "saleId" SET NOT NULL;
DROP INDEX IF EXISTS "DocumentInstance_partyId_idx";
ALTER TABLE "DocumentInstance" DROP COLUMN "sentVia", DROP COLUMN "partyId";
ALTER TABLE "DocumentTemplate" DROP COLUMN "sendableStandalone", DROP COLUMN "journeyStage";
DROP TYPE "DocumentSentVia";
DROP TYPE "JourneyStage";
