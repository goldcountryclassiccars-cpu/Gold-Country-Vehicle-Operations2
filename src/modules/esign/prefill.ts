/**
 * Pre-fills the dealership's own fillable PDFs with what the app already
 * knows about a deal — buyer and co-buyer, the vehicle and its VIN, the agreed
 * price, the 3-day cancellation dates — so staff type only what the app
 * doesn't hold (fees, trade-in, payment method).
 *
 * Fields are matched by name (buyer.name, vehicle.vin, price.cashPrice, …; the
 * full list is FIELD_NAMES below and in SALES_DOCUMENT_SETUP.md). A field the
 * PDF doesn't have is skipped; a field that already holds text is left alone.
 * The form stays fillable: this is a head start, not the final document.
 */
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { readDay } from "@/lib/dealership-date";

export type PrefillValues = Record<string, string>;

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-10-05" → "10/05/2026". */
function usDate(day: string) {
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Civ. Code §1784.31(g)(1): 1.5% of the sale price, at least $200, at most $600. */
export function restockingFee(price: number) {
  return Math.min(600, Math.max(200, Math.round(price * 0.015 * 100) / 100));
}

type PartyLike = {
  displayName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

function partyValues(prefix: "buyer" | "cobuyer", p: PartyLike | null): PrefillValues {
  if (!p) return {};
  return {
    [`${prefix}.name`]: p.displayName,
    [`${prefix}.printedName`]: p.displayName,
    [`${prefix}.street`]: [p.addressLine1, p.addressLine2].filter(Boolean).join(", "),
    [`${prefix}.city`]: p.city ?? "",
    [`${prefix}.state`]: p.state ?? "",
    [`${prefix}.zip`]: p.postalCode ?? "",
    [`${prefix}.phone`]: p.phone ?? "",
    [`${prefix}.email`]: p.email ?? "",
  };
}

export interface PrefillInput {
  saleId: string;
  saleDay: string | null;
  agreedPrice: number;
  salesTax: number | null;
  odometer: number | null;
  stockNumber: string;
  salesperson: string | null;
  isMotorcycle: boolean;
  vehicle: {
    year: number | null;
    make: string;
    model: string;
    trim: string | null;
    bodyStyle: string | null;
    exteriorColor: string | null;
    interiorColor: string | null;
    engine: string | null;
    vin: string | null;
  };
  buyer: PartyLike;
  coBuyer: PartyLike | null;
}

/** Pure: the values for one deal. Empty strings are dropped. */
export function prefillValues(i: PrefillInput): PrefillValues {
  const v: PrefillValues = {
    "sale.agreementNo": i.saleId.slice(0, 8).toUpperCase(),
    "vehicle.stockNumber": i.stockNumber,
    "sale.salesperson": i.salesperson ?? "",
    "vehicle.year": i.vehicle.year ? String(i.vehicle.year) : "",
    "vehicle.make": i.vehicle.make,
    "vehicle.model": [i.vehicle.model, i.vehicle.trim].filter(Boolean).join(" "),
    "vehicle.bodyStyle": i.vehicle.bodyStyle ?? "",
    "vehicle.exteriorColor": i.vehicle.exteriorColor ?? "",
    "vehicle.interiorColor": i.vehicle.interiorColor ?? "",
    "vehicle.engine": i.vehicle.engine ?? "",
    "vehicle.vin": i.vehicle.vin ?? "",
    "vehicle.odometer": i.odometer != null ? i.odometer.toLocaleString("en-US") : "",
    "cancel3.odometerAtSigning": i.odometer != null ? i.odometer.toLocaleString("en-US") : "",
    "price.cashPrice": money(i.agreedPrice),
    "price.salesTax": i.salesTax != null ? money(i.salesTax) : "",
    "cancel3.buyers": [i.buyer.displayName, i.coBuyer?.displayName].filter(Boolean).join(" and "),
    ...partyValues("buyer", i.buyer),
    ...partyValues("cobuyer", i.coBuyer),
  };
  if (i.saleDay) {
    v["sale.date"] = usDate(i.saleDay);
    const qualifies = i.saleDay >= "2026-10-01" && i.agreedPrice <= 50000 && !i.isMotorcycle;
    if (qualifies) {
      v["cancel3.lastDay"] = `${usDate(addDays(i.saleDay, 3))} by close of business`;
      v["cancel3.restockingFee"] = money(restockingFee(i.agreedPrice));
    }
  }
  return Object.fromEntries(Object.entries(v).filter(([, val]) => val !== ""));
}

/**
 * Writes `values` into the PDF's empty text fields and ticks the "qualifies /
 * does not qualify" box for the 3-day right. Returns the input unchanged when
 * the PDF has no form (a scan, the demonstration stand-in).
 */
export async function applyPrefill(bytes: Buffer, values: PrefillValues, qualifies3Day: boolean | null) {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    return bytes;
  }
  const form = pdf.getForm();
  const fields = form.getFields();
  if (fields.length === 0) return bytes;
  let touched = 0;
  for (const [name, value] of Object.entries(values)) {
    try {
      const tf = form.getTextField(name);
      if (!tf.getText()) {
        tf.setText(value);
        touched++;
      }
    } catch {
      /* no such field in this document */
    }
  }
  if (qualifies3Day !== null) {
    for (const f of fields) {
      const n = f.getName();
      if (!/\.check\./.test(n) || !/QUALIF/i.test(n)) continue;
      try {
        const box = form.getCheckBox(n);
        const isNot = /DOES_NOT/i.test(n);
        if (isNot === !qualifies3Day) box.check();
        else box.uncheck();
        touched++;
      } catch {
        /* not a checkbox */
      }
    }
  }
  if (touched === 0) return bytes;
  return Buffer.from(await pdf.save());
}

/** Reads one deal's values from the database. */
export async function prefillForSale(saleId: string): Promise<{ values: PrefillValues; qualifies3Day: boolean | null }> {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  const [episode, buyer, coBuyer, salesperson] = await Promise.all([
    db.inventoryEpisode.findUniqueOrThrow({
      where: { id: sale.episodeId },
      include: { vehicle: { include: { identifiers: true } } },
    }),
    db.party.findUniqueOrThrow({ where: { id: sale.buyerPartyId } }),
    sale.coBuyerPartyId ? db.party.findUnique({ where: { id: sale.coBuyerPartyId } }) : Promise.resolve(null),
    sale.salespersonId ? db.user.findUnique({ where: { id: sale.salespersonId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const vin =
    episode.vehicle.identifiers.find((x) => x.type === "VIN" && x.isPrimary) ??
    episode.vehicle.identifiers.find((x) => x.type === "VIN") ??
    episode.vehicle.identifiers.find((x) => x.isPrimary);
  const saleDay = readDay(sale.saleDate);
  const price = Number(sale.agreedPrice);
  const input: PrefillInput = {
    saleId: sale.id,
    saleDay,
    agreedPrice: price,
    salesTax: sale.salesTaxCollected != null ? Number(sale.salesTaxCollected) : null,
    odometer: sale.odometerAtSale ?? episode.vehicle.mileage ?? null,
    stockNumber: episode.stockNumber,
    salesperson: salesperson?.name ?? null,
    isMotorcycle: episode.vehicle.isMotorcycle,
    vehicle: {
      year: episode.vehicle.year,
      make: episode.vehicle.make,
      model: episode.vehicle.model,
      trim: episode.vehicle.trim,
      bodyStyle: episode.vehicle.bodyStyle,
      exteriorColor: episode.vehicle.exteriorColor,
      interiorColor: episode.vehicle.interiorColor,
      engine: [episode.vehicle.engineDescription, episode.vehicle.transmission].filter(Boolean).join(" / ") || null,
      vin: vin?.value ?? null,
    },
    buyer,
    coBuyer,
  };
  const qualifies3Day = saleDay
    ? saleDay >= "2026-10-01" && price <= 50000 && !episode.vehicle.isMotorcycle
    : null;
  return { values: prefillValues(input), qualifies3Day: saleDay && saleDay >= "2026-10-01" ? qualifies3Day : null };
}
