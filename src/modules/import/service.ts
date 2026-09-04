/**
 * Inventory CSV import: plan, then commit.
 *
 * The two halves are deliberately separate. `planImport` is pure-ish — it
 * reads the database to detect duplicates and resolve acquisition sources, but
 * it writes nothing — so the same function that renders the preview is the one
 * that decides what a commit does. There is no second, divergent code path
 * that could write something the preview never showed.
 *
 * Re-uploading the same file is safe: rows whose identifier already exists are
 * reported as duplicates and skipped. That matters more than atomicity here —
 * a 16-row import that fails on row 15 should leave 14 cars in place and let
 * the operator fix one line and upload again, not roll back an afternoon of
 * data entry.
 */
import { CustodyStatus, DealType, IdentifierType, MarketingStatus, MileageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canViewField } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { createVehicle } from "@/modules/vehicles/service";
import { changeEpisodeStatus, createEpisode } from "@/modules/episodes/service";
import { parseCsv, toTable } from "./csv";
import {
  COLUMNS,
  normalizeIdentifier,
  parseCustodyStatus,
  parseDate,
  parseDealType,
  parseIdentifierType,
  parseInteger,
  parseMarketingStatus,
  parseMileageStatus,
  parseMoney,
} from "./columns";

export const MAX_ROWS = 500;
export const MAX_BYTES = 1_000_000;

export type RowStatus = "ready" | "duplicate" | "possible_duplicate" | "error";

export interface PlannedRow {
  /** 1-based position among data rows — what the operator sees in the preview. */
  index: number;
  /** Line number in the source file, including the header. */
  line: number;
  status: RowStatus;
  /** Short human label, e.g. "1962 Chevrolet Corvette". */
  label: string;
  identifier: string | null;
  dealType: DealType | null;
  askingPrice: number | null;
  stockNumber: string | null;
  errors: string[];
  warnings: string[];
  /** Present when the row is importable. */
  payload?: RowPayload;
  /** Why it was flagged a duplicate. */
  duplicateOf?: string;
}

export interface RowPayload {
  vehicle: {
    year: number | null;
    make: string;
    model: string;
    trim: string | null;
    bodyStyle: string | null;
    exteriorColor: string | null;
    interiorColor: string | null;
    engineDescription: string | null;
    transmission: string | null;
    drivetrain: string | null;
    mileage: number | null;
    mileageStatus: MileageStatus;
    generalDescription: string | null;
    identifier: { type: IdentifierType; value: string } | null;
  };
  episode: {
    dealType: DealType;
    acquisitionSourceId: string | null;
    expectedArrivalAt: Date | null;
    acceptedAt: Date | null;
    askingPrice: number | null;
    stockNumber: string | null;
    purchasePrice: number | null;
    minimumAcceptablePrice: number | null;
    ownerNotes: string | null;
  };
  custodyStatus: CustodyStatus | null;
  marketingStatus: MarketingStatus | null;
}

export interface ImportPlan {
  rows: PlannedRow[];
  /** Header names in the file that the importer does not recognize. */
  unknownColumns: string[];
  /** Required columns missing from the header row. */
  missingColumns: string[];
  fatal?: string;
  counts: { ready: number; duplicate: number; possibleDuplicate: number; error: number };
}

const KNOWN_KEYS = new Set(COLUMNS.map((c) => c.key));

function vehicleLabelOf(year: number | null, make: string, model: string, trim: string | null): string {
  return [year, make, model, trim].filter(Boolean).join(" ") || "(unnamed row)";
}

/**
 * Validate a file against the database and decide, row by row, what a commit
 * would do. Writes nothing.
 */
export async function planImport(user: SessionUser, csvText: string): Promise<ImportPlan> {
  const empty = { ready: 0, duplicate: 0, possibleDuplicate: 0, error: 0 };

  if (csvText.length > MAX_BYTES) {
    return { rows: [], unknownColumns: [], missingColumns: [], counts: empty, fatal: `File is larger than ${Math.round(MAX_BYTES / 1000)} KB. Split it into smaller files.` };
  }

  const table = toTable(parseCsv(csvText));
  if (table.records.length === 0) {
    return { rows: [], unknownColumns: [], missingColumns: [], counts: empty, fatal: "No data rows found. The first line must be the column headers." };
  }
  if (table.records.length > MAX_ROWS) {
    return { rows: [], unknownColumns: [], missingColumns: [], counts: empty, fatal: `${table.records.length} rows is over the ${MAX_ROWS}-row limit. Split the file.` };
  }

  const present = new Set(table.headers.filter(Boolean));
  const missingColumns = ["make", "model", "deal_type"].filter((k) => !present.has(k));
  const unknownColumns = table.headers.filter((h) => h && !KNOWN_KEYS.has(h));
  if (missingColumns.length > 0) {
    return {
      rows: [],
      unknownColumns,
      missingColumns,
      counts: empty,
      fatal: `The file is missing required column${missingColumns.length > 1 ? "s" : ""}: ${missingColumns.join(", ")}. Download the template and paste your data into it.`,
    };
  }

  const [sources, existingIdentifiers, existingStockNumbers, existingActive] = await Promise.all([
    db.acquisitionSource.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.vehicleIdentifier.findMany({ select: { value: true, vehicleId: true } }),
    db.inventoryEpisode.findMany({ select: { stockNumber: true } }),
    db.inventoryEpisode.findMany({
      where: { active: true },
      select: { stockNumber: true, vehicle: { select: { year: true, make: true, model: true } } },
    }),
  ]);

  const sourceByName = new Map(sources.map((s) => [s.name.toLowerCase(), s.id]));
  const identifierIndex = new Map(existingIdentifiers.map((i) => [normalizeIdentifier(i.value), i.vehicleId]));
  const stockNumbers = new Set(existingStockNumbers.map((e) => e.stockNumber));
  const activeByShape = new Map<string, string>();
  for (const e of existingActive) {
    const key = `${e.vehicle.year ?? ""}|${e.vehicle.make.toLowerCase()}|${e.vehicle.model.toLowerCase()}`;
    if (!activeByShape.has(key)) activeByShape.set(key, e.stockNumber);
  }

  const mayWriteCost = canViewField(user, "acquisition_cost");
  const mayWriteMin = canViewField(user, "min_price");
  const mayWriteNotes = canViewField(user, "owner_notes");

  // Duplicates *within* the file are as likely as duplicates against the
  // database — a spreadsheet gets a row pasted twice.
  const seenIdentifiers = new Map<string, number>();
  const seenStock = new Map<string, number>();

  const rows: PlannedRow[] = [];

  table.records.forEach((rec, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const get = (k: string) => rec[k] ?? "";

    const make = get("make");
    const model = get("model");
    if (!make) errors.push("Make is required.");
    if (!model) errors.push("Model is required.");

    const year = parseInteger(get("year"));
    if (year === null) errors.push(`Year "${get("year")}" is not a number.`);
    else if (year !== undefined && (year < 1885 || year > 2100)) errors.push(`Year ${year} is out of range.`);

    const mileage = parseInteger(get("mileage"));
    if (mileage === null) errors.push(`Mileage "${get("mileage")}" is not a number.`);

    let mileageStatus: MileageStatus = MileageStatus.UNKNOWN;
    if (get("mileage_status")) {
      const m = parseMileageStatus(get("mileage_status"));
      if (!m) errors.push(`Mileage status "${get("mileage_status")}" is not one of: Actual, Exempt, Not actual, TMU, Broken odometer, Unknown.`);
      else mileageStatus = m;
    } else if (mileage) {
      warnings.push("No mileage status given — recorded as Unknown. This is the odometer disclosure, so set it if you know it.");
    }

    const dealTypeRaw = get("deal_type");
    const dealType = dealTypeRaw ? parseDealType(dealTypeRaw) : undefined;
    if (!dealTypeRaw) errors.push("Deal type is required (Consignment, Dealer purchase, Brokerage, Other).");
    else if (!dealType) errors.push(`Deal type "${dealTypeRaw}" is not one of: Consignment, Dealer purchase, Brokerage, Other.`);

    const askingPrice = parseMoney(get("asking_price"));
    if (askingPrice === null) errors.push(`Asking price "${get("asking_price")}" is not a number.`);

    const purchasePrice = parseMoney(get("purchase_price"));
    if (purchasePrice === null) errors.push(`Purchase price "${get("purchase_price")}" is not a number.`);
    const minimumPrice = parseMoney(get("minimum_price"));
    if (minimumPrice === null) errors.push(`Minimum price "${get("minimum_price")}" is not a number.`);

    if (get("purchase_price") && !mayWriteCost) warnings.push("Purchase price ignored — your role cannot see acquisition cost.");
    if (get("minimum_price") && !mayWriteMin) warnings.push("Minimum price ignored — your role cannot see minimum price.");
    if (get("owner_notes") && !mayWriteNotes) warnings.push("Owner notes ignored — your role cannot see owner notes.");

    const expectedArrival = parseDate(get("expected_arrival"));
    if (expectedArrival === null) errors.push(`Expected arrival "${get("expected_arrival")}" is not a date (use YYYY-MM-DD).`);

    const acquiredDate = parseDate(get("acquired_date"));
    if (acquiredDate === null) errors.push(`Date acquired "${get("acquired_date")}" is not a date (use YYYY-MM-DD).`);
    else if (acquiredDate && acquiredDate.getTime() > Date.now()) errors.push(`Date acquired ${get("acquired_date")} is in the future.`);
    else if (acquiredDate === undefined) warnings.push("No acquired date — days in inventory will count from today.");

    let custodyStatus: CustodyStatus | null = null;
    if (get("custody_status")) {
      const c = parseCustodyStatus(get("custody_status"));
      if (!c) errors.push(`Custody "${get("custody_status")}" is not a recognized location status.`);
      else custodyStatus = c;
    }

    let marketingStatus: MarketingStatus | null = null;
    if (get("marketing_status")) {
      const m = parseMarketingStatus(get("marketing_status"));
      if (!m) errors.push(`Marketing "${get("marketing_status")}" is not one of: Live, Ready for listing, Media pending, Not ready, Paused, Withdrawn.`);
      else marketingStatus = m;
    }

    let acquisitionSourceId: string | null = null;
    if (get("acquisition_source")) {
      const id = sourceByName.get(get("acquisition_source").toLowerCase());
      if (!id) errors.push(`Acquisition source "${get("acquisition_source")}" does not exist. Valid: ${sources.map((s) => s.name).join(", ") || "(none configured)"}.`);
      else acquisitionSourceId = id;
    }

    const identifierValue = get("identifier_value");
    let identifierType: IdentifierType | null = null;
    if (identifierValue) {
      if (get("identifier_type")) {
        const t = parseIdentifierType(get("identifier_type"));
        if (!t) errors.push(`Identifier type "${get("identifier_type")}" is not recognized.`);
        else identifierType = t;
      } else {
        const bare = normalizeIdentifier(identifierValue);
        identifierType = bare.length === 17 ? IdentifierType.VIN : IdentifierType.SHORT_VIN;
        warnings.push(
          `No identifier type given — assumed ${identifierType === IdentifierType.VIN ? "VIN" : "Short VIN"}. On a pre-1981 car this is often really a chassis or serial number.`,
        );
      }
    } else if (get("identifier_type")) {
      warnings.push("Identifier type given with no number — ignored.");
    }

    const stockNumber: string | null = get("stock_number") || null;
    if (stockNumber) {
      if (stockNumbers.has(stockNumber)) errors.push(`Stock number ${stockNumber} is already used by another vehicle.`);
      const dupLine = seenStock.get(stockNumber);
      if (dupLine) errors.push(`Stock number ${stockNumber} also appears on row ${dupLine} of this file.`);
      else seenStock.set(stockNumber, i + 1);
    }

    const label = vehicleLabelOf(year ?? null, make, model, get("trim") || null);

    // ---- duplicate detection -------------------------------------------
    let status: RowStatus = errors.length > 0 ? "error" : "ready";
    let duplicateOf: string | undefined;

    if (status === "ready" && identifierValue) {
      const norm = normalizeIdentifier(identifierValue);
      const fileDup = seenIdentifiers.get(norm);
      if (fileDup) {
        status = "duplicate";
        duplicateOf = `row ${fileDup} of this file`;
      } else if (identifierIndex.has(norm)) {
        status = "duplicate";
        duplicateOf = "a vehicle already in the app with this number";
      } else {
        seenIdentifiers.set(norm, i + 1);
      }
    } else if (status === "ready" && !identifierValue) {
      const key = `${year ?? ""}|${make.toLowerCase()}|${model.toLowerCase()}`;
      const match = activeByShape.get(key);
      if (match) {
        status = "possible_duplicate";
        duplicateOf = `${match} — same year, make and model, and this row has no VIN to tell them apart`;
      }
    }

    const payload: RowPayload | undefined =
      status === "error"
        ? undefined
        : {
            vehicle: {
              year: year ?? null,
              make,
              model,
              trim: get("trim") || null,
              bodyStyle: get("body_style") || null,
              exteriorColor: get("exterior_color") || null,
              interiorColor: get("interior_color") || null,
              engineDescription: get("engine") || null,
              transmission: get("transmission") || null,
              drivetrain: get("drivetrain") || null,
              mileage: mileage ?? null,
              mileageStatus,
              generalDescription: get("description") || null,
              identifier: identifierValue && identifierType ? { type: identifierType, value: identifierValue } : null,
            },
            episode: {
              dealType: dealType ?? DealType.OTHER,
              acquisitionSourceId,
              expectedArrivalAt: expectedArrival ?? null,
              acceptedAt: acquiredDate ?? null,
              askingPrice: askingPrice ?? null,
              stockNumber,
              purchasePrice: mayWriteCost ? purchasePrice ?? null : null,
              minimumAcceptablePrice: mayWriteMin ? minimumPrice ?? null : null,
              ownerNotes: mayWriteNotes ? get("owner_notes") || null : null,
            },
            custodyStatus,
            marketingStatus,
          };

    rows.push({
      index: i + 1,
      line: table.lineNumbers[i] ?? i + 2,
      status,
      label,
      identifier: identifierValue || null,
      dealType: dealType ?? null,
      askingPrice: askingPrice ?? null,
      stockNumber,
      errors,
      warnings,
      payload,
      duplicateOf,
    });
  });

  return {
    rows,
    unknownColumns,
    missingColumns,
    counts: {
      ready: rows.filter((r) => r.status === "ready").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      possibleDuplicate: rows.filter((r) => r.status === "possible_duplicate").length,
      error: rows.filter((r) => r.status === "error").length,
    },
  };
}

export interface ImportResult {
  created: { index: number; label: string; stockNumber: string }[];
  failed: { index: number; label: string; message: string }[];
  skipped: number;
}

/**
 * Write the rows the plan marked importable.
 *
 * `forceIndexes` opts in the "possible duplicate" rows the operator confirmed
 * are genuinely different cars. Rows that are hard duplicates or in error are
 * never written, whatever is passed.
 */
export async function commitImport(user: SessionUser, plan: ImportPlan, forceIndexes: Set<number>): Promise<ImportResult> {
  const toWrite = plan.rows.filter(
    (r) => r.payload && (r.status === "ready" || (r.status === "possible_duplicate" && forceIndexes.has(r.index))),
  );

  const created: ImportResult["created"] = [];
  const failed: ImportResult["failed"] = [];

  for (const row of toWrite) {
    const p = row.payload!;
    try {
      const vehicle = await createVehicle(user, p.vehicle);
      const episode = await createEpisode(user, {
        vehicleId: vehicle.id,
        dealType: p.episode.dealType,
        acquisitionSourceId: p.episode.acquisitionSourceId,
        expectedArrivalAt: p.episode.expectedArrivalAt,
        acceptedAt: p.episode.acceptedAt,
        askingPrice: p.episode.askingPrice,
        purchasePrice: p.episode.purchasePrice,
        minimumAcceptablePrice: p.episode.minimumAcceptablePrice,
        ownerNotes: p.episode.ownerNotes,
      });

      // An explicit stock number replaces the generated one. Done as an update
      // rather than a parameter so the generator stays the single owner of the
      // counter and there is no path where a supplied number silently consumes
      // a GC-#### slot without advancing it.
      let stockNumber = episode.stockNumber;
      if (p.episode.stockNumber) {
        await db.inventoryEpisode.update({ where: { id: episode.id }, data: { stockNumber: p.episode.stockNumber } });
        stockNumber = p.episode.stockNumber;
      }

      // Statuses go through changeStatus so each one appends its StatusChange
      // history row — an imported car has the same audit trail as a typed one.
      if (p.custodyStatus) {
        await changeEpisodeStatus(user, episode.id, "custody", p.custodyStatus, "Set during inventory import");
      }
      if (p.marketingStatus) {
        await changeEpisodeStatus(user, episode.id, "marketing", p.marketingStatus, "Set during inventory import");
      }

      created.push({ index: row.index, label: row.label, stockNumber });
    } catch (e) {
      failed.push({ index: row.index, label: row.label, message: e instanceof Error ? e.message : String(e) });
    }
  }

  await audit(user, {
    action: "inventory.import",
    resourceType: "inventory_import",
    newValues: {
      rowsInFile: plan.rows.length,
      created: created.length,
      failed: failed.length,
      skippedDuplicates: plan.counts.duplicate,
      skippedErrors: plan.counts.error,
      forced: [...forceIndexes],
      stockNumbers: created.map((c) => c.stockNumber),
    },
  });

  return {
    created,
    failed,
    skipped: plan.rows.length - created.length - failed.length,
  };
}
