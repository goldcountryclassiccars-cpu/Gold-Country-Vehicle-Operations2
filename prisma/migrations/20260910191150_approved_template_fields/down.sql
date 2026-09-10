-- Reverse of migration.sql. Four nullable columns; reversing loses only the
-- pointers to uploaded approved templates (the files themselves remain).
ALTER TABLE "DocumentTemplate"
  DROP COLUMN IF EXISTS "approvedFileId",
  DROP COLUMN IF EXISTS "approvedAt",
  DROP COLUMN IF EXISTS "approvedById",
  DROP COLUMN IF EXISTS "approvedVersionNote";
