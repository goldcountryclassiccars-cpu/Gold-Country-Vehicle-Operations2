-- Rollback for photos_and_video_links
DROP TABLE IF EXISTS "VideoLink";
ALTER TABLE "MediaAsset" DROP COLUMN IF EXISTS "webFileId";
ALTER TABLE "MediaAsset" DROP COLUMN IF EXISTS "thumbFileId";
