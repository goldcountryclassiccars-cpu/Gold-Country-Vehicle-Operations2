-- Reverses 20261019200000_listing_tool. Drops the Listing Tool tables and the
-- two media columns; intake photos and video links are untouched otherwise.
-- Listing-purpose MediaAsset rows would become indistinguishable from intake
-- photos after this, so archive them first if any exist.
UPDATE "MediaAsset" SET "archivedAt" = NOW() WHERE "purpose" = 'LISTING' AND "archivedAt" IS NULL;
DELETE FROM "VideoLink" WHERE "purpose" = 'LISTING';
DROP TABLE IF EXISTS "ListingPublication";
DROP TABLE IF EXISTS "ListingChannel";
DROP TABLE IF EXISTS "Listing";
DROP INDEX IF EXISTS "MediaAsset_episodeId_purpose_kind_idx";
ALTER TABLE "MediaAsset" DROP COLUMN IF EXISTS "largeFileId", DROP COLUMN IF EXISTS "purpose";
ALTER TABLE "VideoLink" DROP COLUMN IF EXISTS "purpose", DROP COLUMN IF EXISTS "sortOrder";
DROP TYPE IF EXISTS "PublicationStatus";
DROP TYPE IF EXISTS "ListingChannelMethod";
DROP TYPE IF EXISTS "ListingPriceDisplay";
DROP TYPE IF EXISTS "MediaPurpose";
