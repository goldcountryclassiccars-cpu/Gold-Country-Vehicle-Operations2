-- Reverse of migration.sql. Prisma has no built-in down migration, so this is
-- kept by hand and applied with:
--   psql "$DIRECT_URL" -f prisma/migrations/20260905191449_sale_document_requirements/down.sql
--
-- Everything in the forward migration is additive: new tables, new nullable or
-- defaulted columns, new enums. Nothing here touches a pre-existing value, so
-- reversing loses only the sale-document tracking itself.

DROP TABLE IF EXISTS "SaleDocumentRequirement";

ALTER TABLE "DocumentTemplate"
  DROP COLUMN IF EXISTS "category",
  DROP COLUMN IF EXISTS "authority",
  DROP COLUMN IF EXISTS "appliesWhen",
  DROP COLUMN IF EXISTS "signers",
  DROP COLUMN IF EXISTS "eSign",
  DROP COLUMN IF EXISTS "physicalOriginal",
  DROP COLUMN IF EXISTS "buyerCopy",
  DROP COLUMN IF EXISTS "retain",
  DROP COLUMN IF EXISTS "submitTo",
  DROP COLUMN IF EXISTS "timing",
  DROP COLUMN IF EXISTS "effectiveFrom",
  DROP COLUMN IF EXISTS "effectiveTo",
  DROP COLUMN IF EXISTS "worksheetFields",
  DROP COLUMN IF EXISTS "notes",
  DROP COLUMN IF EXISTS "verifyWithCounsel";

ALTER TABLE "SaleTransaction"
  DROP COLUMN IF EXISTS "saleDate",
  DROP COLUMN IF EXISTS "deliveryState",
  DROP COLUMN IF EXISTS "deliveryMethod",
  DROP COLUMN IF EXISTS "registrationState",
  DROP COLUMN IF EXISTS "outsideLender",
  DROP COLUMN IF EXISTS "lenderPartyId",
  DROP COLUMN IF EXISTS "negotiatedLanguage",
  DROP COLUMN IF EXISTS "reg51SerialNo",
  DROP COLUMN IF EXISTS "tempPlateNo",
  DROP COLUMN IF EXISTS "odometerAtSale",
  DROP COLUMN IF EXISTS "salesTaxCollected",
  DROP COLUMN IF EXISTS "cancellationWindowEndsAt",
  DROP COLUMN IF EXISTS "deliveredToBuyerAt",
  DROP COLUMN IF EXISTS "manualAnswers";

ALTER TABLE "Vehicle"
  DROP COLUMN IF EXISTS "fuelType",
  DROP COLUMN IF EXISTS "isMotorcycle";

ALTER TABLE "Arrangement"
  DROP COLUMN IF EXISTS "titleState";

DROP TYPE IF EXISTS "RequirementState";
DROP TYPE IF EXISTS "DocumentTiming";
DROP TYPE IF EXISTS "NegotiatedLanguage";
DROP TYPE IF EXISTS "DeliveryMethod";
DROP TYPE IF EXISTS "FuelType";
