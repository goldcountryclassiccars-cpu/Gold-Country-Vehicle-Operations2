/**
 * Builds the flat context the rule engine evaluates against.
 *
 * Everything that touches the database lives here so rules.ts can stay pure.
 * The paths below are the contract with prisma/document-registry.json — the
 * `context` block at the top of that file lists the same set and where each
 * one comes from. Adding a rule that reads a new path means adding it here.
 *
 * A value that is genuinely unknown must be left OUT (or null), never
 * defaulted. A default of "CA" for delivery state would turn "we haven't asked
 * yet" into a confident wrong answer about sales tax.
 */
import { db } from "@/lib/db";
import { storeDay } from "@/lib/dealership-date";
import type { RuleContext } from "./rules";

/**
 * Employee-entered answers stored on `SaleTransaction.manualAnswers`.
 *
 * These are facts about the paper in the folder that no other record holds:
 * whether the title has a price field, whether the name on it matches the
 * consignor, whether there is reassignment space left. Each is tri-state —
 * absent means "nobody has looked yet", which the engine reports as UNKNOWN.
 */
export interface ManualAnswers {
  "title.hasPriceField"?: boolean;
  "title.sellerNameMatches"?: boolean;
  "title.reassignmentSpaceAvailable"?: boolean;
  "manual.reg256Needed"?: boolean;
  "manual.reg135Needed"?: boolean;
  "manual.consignorPOA"?: boolean;
  "manual.buyerPOA"?: boolean;
  "manual.smogExemptionClaimed"?: boolean;
  "sale.hasDueBillItems"?: boolean;
  "sale.hasAddOns"?: boolean;
}

export const MANUAL_ANSWER_FIELDS = [
  {
    key: "title.hasPriceField" as const,
    label: "Title has a price field",
    hint: "If the title has nowhere to write the selling price, the DMV wants a REG 135 Bill of Sale instead.",
  },
  {
    key: "title.sellerNameMatches" as const,
    label: "Name on the title matches the seller",
    hint: "A mismatch between the registered owner and who is selling also calls for a REG 135.",
  },
  {
    key: "title.reassignmentSpaceAvailable" as const,
    label: "Title has reassignment space left",
    hint: "When the dealer reassignment boxes are used up, the transfer moves onto a REG 262.",
  },
  {
    key: "manual.reg256Needed" as const,
    label: "A Statement of Facts is needed for another reason",
    hint: "Anything the DMV needs explained in writing that the other rules do not already catch.",
  },
  {
    key: "manual.reg135Needed" as const,
    label: "A REG 135 Bill of Sale is needed for another reason",
    hint: "Add one manually when the situation calls for it.",
  },
  {
    key: "manual.consignorPOA" as const,
    label: "Consignor power of attorney needed",
    hint: "A POA cannot sign the odometer disclosure on the signer's own behalf — the transferor still signs that.",
  },
  {
    key: "manual.buyerPOA" as const,
    label: "Buyer power of attorney needed",
    hint: "Usually when the buyer cannot be present to sign the DMV paperwork.",
  },
  {
    key: "sale.hasDueBillItems" as const,
    label: "Anything promised after the sale",
    hint: "Touch-up, a missing part, a service — anything owed becomes a written Due Bill.",
  },
  {
    key: "sale.hasAddOns" as const,
    label: "Optional add-on products sold",
    hint: "Service contracts, paint protection and the like need their own CARS Act disclosure from 2026-10-01.",
  },
];

/** Why each sale-time input is asked, shown inline on the form. */
export const SALE_INPUT_HINTS: Record<string, string> = {
  saleDate:
    "Decides which cancellation notice applies — the Contract Cancellation Option through 2026-09-30, the 3-Day Right to Cancel from 2026-10-01.",
  deliveryState:
    "Where the buyer physically takes the car decides the tax treatment. Out-of-state delivery by us or a carrier supports the CDTFA-448 exemption; a pickup here means California tax is due.",
  deliveryMethod:
    "Common carrier or dealer delivery is what makes an out-of-state delivery hold up, and the delivery receipt starts the cancellation clock.",
  registrationState:
    "Where the buyer registers decides whether a smog certificate and a CA title application are needed at all.",
  outsideLender: "A third-party lender goes on the REG 51 and the title as legal owner.",
  negotiatedLanguage: "A deal negotiated in Spanish needs the Spanish Buyers Guide.",
  odometerAtSale: "Goes on the odometer disclosure and the REG 262.",
  salesTaxCollected: "Recorded for the REG 51. Leave blank only if no California tax is due.",
  cancellationWindowEndsAt:
    "Nothing can be paid out to a consignor until this passes. Ends at close of business on the third calendar day after delivery.",
};

/** Extracts the manual answers blob, tolerating a null or malformed column. */
export function readManualAnswers(value: unknown): ManualAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ManualAnswers;
}

/**
 * Assembles every path the registry can ask about for one sale.
 *
 * Keys are omitted rather than set to null when the answer is unknown, so the
 * engine can tell "not answered" from "answered as nothing".
 */
export async function buildSaleContext(saleId: string): Promise<RuleContext> {
  const sale = await db.saleTransaction.findUniqueOrThrow({
    where: { id: saleId },
    include: { payments: true },
  });
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: sale.episodeId },
    include: { vehicle: true, arrangement: true },
  });
  const buyer = await db.party.findUnique({ where: { id: sale.buyerPartyId } });

  const ctx: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null) ctx[key] = value;
  };

  const v = episode.vehicle;
  put("vehicle.year", v.year);
  put("vehicle.mileageStatus", v.mileageStatus);
  put("vehicle.titleBrand", v.titleBrand);
  put("vehicle.fuelType", v.fuelType);
  // isMotorcycle is a non-null boolean with a default, so it is always known.
  ctx["vehicle.isMotorcycle"] = v.isMotorcycle;
  put("vehicle.make", v.make);
  put("vehicle.model", v.model);
  put("vehicle.bodyStyle", v.bodyStyle);

  put("episode.dealType", episode.dealType);
  put("episode.stockNumber", episode.stockNumber);

  put("arrangement.titleStatus", episode.arrangement?.titleStatus);
  put("arrangement.lienStatus", episode.arrangement?.lienStatus);
  put("arrangement.titleState", episode.arrangement?.titleState);

  // saleDate falls back to contractedAt: an older deal contracted before this
  // field existed still has a real date, and the cancellation rules turn on it.
  // contractedAt is a raw instant, so it is converted to the calendar day here
  // rather than in the engine — the engine stays pure and timezone-free.
  const saleDay = sale.saleDate ?? (sale.contractedAt ? storeDay(sale.contractedAt) : null);
  put("sale.saleDate", saleDay);
  put("sale.agreedPrice", Number(sale.agreedPrice));
  put("sale.buyerState", buyer?.state);
  put("sale.deliveryState", sale.deliveryState);
  put("sale.deliveryMethod", sale.deliveryMethod);
  put("sale.registrationState", sale.registrationState);
  ctx["sale.outsideLender"] = sale.outsideLender;
  put("sale.negotiatedLanguage", sale.negotiatedLanguage);
  put("sale.odometerAtSale", sale.odometerAtSale);
  put("sale.salesTaxCollected", sale.salesTaxCollected == null ? null : Number(sale.salesTaxCollected));

  // Derived from the payment ledger rather than asked: IRS Form 8300 turns on
  // cash actually taken, and an employee should not have to remember to tick it.
  const cash = sale.payments
    .filter((p) => p.method === "CASH" && p.kind !== "REFUND" && p.status !== "FAILED")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  ctx["sale.paymentIncludesCashOver10k"] = cash >= 10000;

  // Model-year age, not calendar age: "vehicle.ageAtSaleModelYears" is what
  // both the federal odometer exemption and the smog transfer-fee window use.
  if (saleDay && v.year != null) {
    ctx["vehicle.ageAtSaleModelYears"] = saleDay.getUTCFullYear() - v.year;
  }

  const manual = readManualAnswers(sale.manualAnswers);
  for (const [key, value] of Object.entries(manual)) {
    if (typeof value === "boolean") ctx[key] = value;
  }

  return ctx;
}
