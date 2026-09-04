/**
 * The inventory import column contract.
 *
 * One place defines the template header, the human help text shown on the
 * import screen, and how each loose spreadsheet value becomes a strict enum or
 * number. Keeping all three together means the template a person downloads can
 * never drift from what the parser accepts.
 */
import { CustodyStatus, DealType, IdentifierType, MarketingStatus, MileageStatus } from "@prisma/client";

export interface ColumnSpec {
  key: string;
  label: string;
  required?: boolean;
  /** Shown in the on-screen column guide. */
  help: string;
  /** Only written when the importing user holds the matching field grant. */
  sensitive?: "acquisition_cost" | "min_price" | "owner_notes";
}

export const COLUMNS: ColumnSpec[] = [
  { key: "year", label: "Year", help: "Four digits. Leave blank if genuinely unknown." },
  { key: "make", label: "Make", required: true, help: "Required. e.g. Chevrolet, Austin-Healey." },
  { key: "model", label: "Model", required: true, help: "Required. e.g. Corvette, Sprite." },
  { key: "trim", label: "Trim", help: "e.g. GT, Bugeye, Indy 500 Pace Car." },
  { key: "body_style", label: "Body style", help: "e.g. Convertible, Coupe, Roadster." },
  { key: "exterior_color", label: "Exterior color", help: "Free text — use the shop's words." },
  { key: "interior_color", label: "Interior color", help: "Free text — e.g. Red, Black and red, Biscuit leather." },
  { key: "engine", label: "Engine", help: "e.g. V8 5.7L, I4 948cc." },
  { key: "transmission", label: "Transmission", help: "e.g. Manual 4-Speed, Automatic." },
  { key: "drivetrain", label: "Drivetrain", help: "e.g. RWD, 4X4, AWD." },
  { key: "mileage", label: "Mileage", help: "Digits. Commas are fine — 61,233 works." },
  {
    key: "mileage_status",
    label: "Mileage status",
    help: "Actual, Exempt, Not actual, TMU, Broken odometer, or Unknown. Blank means Unknown — this is an odometer disclosure, so set it deliberately rather than letting it default.",
  },
  {
    key: "identifier_type",
    label: "Identifier type",
    help: "VIN, Short VIN, Chassis, Serial, Engine, Body, Cowl tag, Other, Unknown. Blank guesses from the value's length, which is often wrong on pre-1981 cars — set it.",
  },
  { key: "identifier_value", label: "VIN / chassis / serial", help: "The number itself. Blank is allowed; duplicate detection then falls back to year + make + model." },
  { key: "description", label: "Description", help: "The long seller description. Commas and quotes are fine." },
  {
    key: "deal_type",
    label: "Deal type",
    required: true,
    help: "Required. Consignment, Dealer purchase, Brokerage, or Other.",
  },
  { key: "asking_price", label: "Asking price", help: "$ and commas are fine — $49,900 works." },
  {
    key: "stock_number",
    label: "Stock number",
    help: "Leave blank and the app assigns the next GC-#### itself. Fill it only to carry an existing number across; it must be unique.",
  },
  { key: "acquisition_source", label: "Acquisition source", help: "Must match an existing source name exactly (case-insensitive). Blank is allowed." },
  { key: "expected_arrival", label: "Expected arrival", help: "YYYY-MM-DD or M/D/YYYY. For a car already on the lot, leave blank and set custody to On site." },
  {
    key: "acquired_date",
    label: "Date acquired",
    help: "YYYY-MM-DD. When the car came into inventory. Blank means today — which would restart the aging clock on cars you have had for months, so fill it for existing inventory.",
  },
  {
    key: "custody_status",
    label: "Custody",
    help: "Where the car physically is: On site, Expected, Inbound transport, Detail area, Mechanical area, Body shop, Offsite vendor. Blank means Expected.",
  },
  {
    key: "marketing_status",
    label: "Marketing",
    help: "Live, Ready for listing, Media pending, Not ready, Paused, Withdrawn. Blank means Not ready. Use Live for cars already advertised.",
  },
  { key: "purchase_price", label: "Purchase price", help: "Confidential. Written only if you hold the acquisition-cost grant.", sensitive: "acquisition_cost" },
  { key: "minimum_price", label: "Minimum price", help: "Confidential. Written only if you hold the minimum-price grant.", sensitive: "min_price" },
  { key: "owner_notes", label: "Owner notes", help: "Confidential. Written only if you hold the owner-notes grant.", sensitive: "owner_notes" },
];

export const TEMPLATE_HEADER = COLUMNS.map((c) => c.key);

/** A filled example row, so the template shows the shape rather than describing it. */
export const TEMPLATE_EXAMPLE = [
  "1962",
  "Chevrolet",
  "Corvette",
  "",
  "Convertible",
  "Black",
  "Black",
  "V8 5.4L",
  "Manual 4-Speed",
  "RWD",
  "74,010",
  "Actual",
  "Short VIN",
  "208673109656",
  "Triple black matching-numbers 340HP solid lift cam car, purchased new locally.",
  "Consignment",
  "$73,900",
  "",
  "",
  "",
  "2026-06-14",
  "On site",
  "Live",
  "",
  "",
  "",
];

// ---------------------------------------------------------------------------
// Loose value → strict value
// ---------------------------------------------------------------------------

/** Compare two labels ignoring case, spaces, hyphens and underscores. */
function loose(v: string): string {
  return v.toLowerCase().replace(/[\s_-]+/g, "");
}

function matcher<T extends string>(map: Record<string, T>): (raw: string) => T | undefined {
  const table = new Map<string, T>();
  for (const [k, v] of Object.entries(map)) table.set(loose(k), v);
  return (raw: string) => table.get(loose(raw));
}

export const parseDealType = matcher<DealType>({
  consignment: DealType.CONSIGNMENT,
  consigned: DealType.CONSIGNMENT,
  consign: DealType.CONSIGNMENT,
  "dealer purchase": DealType.DEALER_PURCHASE,
  "dealer owned": DealType.DEALER_PURCHASE,
  dealer: DealType.DEALER_PURCHASE,
  purchase: DealType.DEALER_PURCHASE,
  owned: DealType.DEALER_PURCHASE,
  bought: DealType.DEALER_PURCHASE,
  brokerage: DealType.BROKERAGE,
  broker: DealType.BROKERAGE,
  other: DealType.OTHER,
  DEALER_PURCHASE: DealType.DEALER_PURCHASE,
  CONSIGNMENT: DealType.CONSIGNMENT,
  BROKERAGE: DealType.BROKERAGE,
  OTHER: DealType.OTHER,
});

export const parseIdentifierType = matcher<IdentifierType>({
  vin: IdentifierType.VIN,
  "vin 17": IdentifierType.VIN,
  "short vin": IdentifierType.SHORT_VIN,
  shortvin: IdentifierType.SHORT_VIN,
  chassis: IdentifierType.CHASSIS_NUMBER,
  "chassis number": IdentifierType.CHASSIS_NUMBER,
  serial: IdentifierType.SERIAL_NUMBER,
  "serial number": IdentifierType.SERIAL_NUMBER,
  engine: IdentifierType.ENGINE_NUMBER,
  "engine number": IdentifierType.ENGINE_NUMBER,
  body: IdentifierType.BODY_NUMBER,
  "body number": IdentifierType.BODY_NUMBER,
  cowl: IdentifierType.COWL_TAG,
  "cowl tag": IdentifierType.COWL_TAG,
  other: IdentifierType.OTHER,
  unknown: IdentifierType.UNKNOWN_PENDING,
  pending: IdentifierType.UNKNOWN_PENDING,
  "unknown pending": IdentifierType.UNKNOWN_PENDING,
});

export const parseMileageStatus = matcher<MileageStatus>({
  actual: MileageStatus.ACTUAL,
  exempt: MileageStatus.EXEMPT,
  "exempt age": MileageStatus.EXEMPT,
  "not actual": MileageStatus.NOT_ACTUAL,
  tmu: MileageStatus.TMU,
  "true mileage unknown": MileageStatus.TMU,
  "broken odometer": MileageStatus.BROKEN_ODOMETER,
  broken: MileageStatus.BROKEN_ODOMETER,
  unknown: MileageStatus.UNKNOWN,
});

export const parseCustodyStatus = matcher<CustodyStatus>({
  expected: CustodyStatus.EXPECTED,
  "inbound transport": CustodyStatus.INBOUND_TRANSPORT,
  inbound: CustodyStatus.INBOUND_TRANSPORT,
  "on site": CustodyStatus.ON_SITE,
  onsite: CustodyStatus.ON_SITE,
  "on lot": CustodyStatus.ON_SITE,
  here: CustodyStatus.ON_SITE,
  "detail area": CustodyStatus.DETAIL_AREA,
  detail: CustodyStatus.DETAIL_AREA,
  "mechanical area": CustodyStatus.MECHANICAL_AREA,
  mechanical: CustodyStatus.MECHANICAL_AREA,
  shop: CustodyStatus.MECHANICAL_AREA,
  "body shop": CustodyStatus.BODY_SHOP,
  "media area": CustodyStatus.MEDIA_AREA,
  "offsite vendor": CustodyStatus.OFFSITE_VENDOR,
  offsite: CustodyStatus.OFFSITE_VENDOR,
});

export const parseMarketingStatus = matcher<MarketingStatus>({
  "not ready": MarketingStatus.NOT_READY,
  "media pending": MarketingStatus.MEDIA_PENDING,
  "media in progress": MarketingStatus.MEDIA_IN_PROGRESS,
  "ready for listing": MarketingStatus.READY_FOR_LISTING,
  ready: MarketingStatus.READY_FOR_LISTING,
  live: MarketingStatus.LIVE,
  listed: MarketingStatus.LIVE,
  advertised: MarketingStatus.LIVE,
  paused: MarketingStatus.PAUSED,
  withdrawn: MarketingStatus.WITHDRAWN,
});

/** "$49,900" / "49900.00" / "" → 49900 / undefined. Returns null on junk. */
export function parseMoney(raw: string): number | undefined | null {
  const s = raw.replace(/[$,\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** "61,233" → 61233. Returns null on junk. */
export function parseInteger(raw: string): number | undefined | null {
  const s = raw.replace(/[,\s]/g, "");
  if (!s) return undefined;
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Accepts YYYY-MM-DD and M/D/YYYY. Returns null on junk. */
export function parseDate(raw: string): Date | undefined | null {
  const s = raw.trim();
  if (!s) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) [, y, m, d] = [0, Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [, m, d, y] = [0, Number(us[1]), Number(us[2]), Number(us[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * Identifiers are compared for duplicate detection with punctuation and case
 * removed, because the same chassis number gets typed as "AN5L-4702",
 * "an5l 4702" and "AN5L4702" by three different people.
 */
export function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
