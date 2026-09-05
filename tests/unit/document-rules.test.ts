/**
 * Rule-engine tests.
 *
 * These run against the real registry file rather than fixtures invented here,
 * so a rule edited in prisma/document-registry.json is checked by exactly these
 * assertions. The scenarios are the ones that actually walk through the door:
 * a consignment classic, a modern trade, a motorcycle, an out-of-state buyer,
 * and the CARS Act cut-over on 2026-10-01.
 *
 * NOT LEGAL ADVICE — these assert what the registry says, not what the law
 * says. Every rule marked verify=true still needs dealer counsel.
 */
import { describe, expect, it } from "vitest";
import { loadRegistry, planTemplates } from "../../prisma/seed-document-registry";
import { evaluateRules, type RequirementState, type Rule, type RuleTemplate } from "@/modules/documents/rules";
import { dealershipDayString, readDay, storeDay } from "@/lib/dealership-date";

const templates: RuleTemplate[] = planTemplates(loadRegistry()).map(({ key, data }) => ({
  key,
  appliesWhen: (data.appliesWhen ?? null) as Rule | null,
  effectiveFrom: data.effectiveFrom ?? null,
  effectiveTo: data.effectiveTo ?? null,
}));

type Ctx = Record<string, unknown>;

/** A complete, unambiguous baseline — every scenario below changes a few keys. */
function baseContext(over: Ctx = {}): Ctx {
  return {
    "vehicle.year": 1969,
    "vehicle.mileageStatus": "ACTUAL",
    "vehicle.isMotorcycle": false,
    "vehicle.fuelType": "GAS",
    "episode.dealType": "CONSIGNMENT",
    "arrangement.titleStatus": "present",
    "arrangement.titleState": "CA",
    "arrangement.lienStatus": "none",
    "sale.saleDate": "2026-09-20",
    "sale.agreedPrice": 38500,
    "sale.buyerState": "CA",
    "sale.deliveryState": "CA",
    "sale.deliveryMethod": "BUYER_PICKUP",
    "sale.registrationState": "CA",
    "sale.outsideLender": false,
    "sale.negotiatedLanguage": "EN",
    "sale.paymentIncludesCashOver10k": false,
    "sale.hasDueBillItems": false,
    "sale.hasAddOns": false,
    "title.hasPriceField": true,
    "title.sellerNameMatches": true,
    "title.reassignmentSpaceAvailable": true,
    "manual.reg256Needed": false,
    "manual.reg135Needed": false,
    "manual.consignorPOA": false,
    "manual.buyerPOA": false,
    ...over,
  };
}

function evaluate(over: Ctx = {}) {
  const results = evaluateRules(baseContext(over), templates);
  const byKey = new Map(results.map((r) => [r.key, r]));
  return {
    state: (key: string): RequirementState => {
      const row = byKey.get(key);
      if (!row) throw new Error(`no such template: ${key}`);
      return row.state;
    },
    reason: (key: string): string => byKey.get(key)!.reason,
    all: results,
  };
}

/** Context with a key genuinely absent, which is different from set-to-null. */
function without(key: string, over: Ctx = {}) {
  const ctx = baseContext(over);
  delete ctx[key];
  return evaluateRules(ctx, templates);
}

describe("registry loading", () => {
  it("plans a template for every registry document, plus one per extra version", () => {
    const registry = loadRegistry();
    const planned = planTemplates(registry);
    expect(planned.length).toBeGreaterThanOrEqual(registry.documents.length);
    // The base key survives so existing demo templates do not orphan.
    expect(planned.map((p) => p.key)).toContain("purchase_agreement");
    expect(planned.map((p) => p.key)).toContain("buyers_guide");
  });
});

describe("deal type", () => {
  it("requires the consignment paperwork on a consigned car", () => {
    const r = evaluate({ "episode.dealType": "CONSIGNMENT" });
    expect(r.state("consignment_agreement")).toBe("REQUIRED");
    expect(r.state("consignor_settlement")).toBe("REQUIRED");
    expect(r.state("reg_138_release_of_liability")).toBe("REQUIRED");
    expect(r.state("consignor_proof_of_payment")).toBe("REQUIRED");
  });

  it("drops all of it on a dealer purchase, and says why", () => {
    const r = evaluate({ "episode.dealType": "DEALER_PURCHASE" });
    expect(r.state("consignment_agreement")).toBe("NOT_REQUIRED");
    expect(r.state("consignor_settlement")).toBe("NOT_REQUIRED");
    expect(r.state("consignor_proof_of_payment")).toBe("NOT_REQUIRED");
    expect(r.reason("consignment_agreement")).toContain("DEALER_PURCHASE");
  });

  it("asks for the lien payoff authorization only when there is a lien", () => {
    expect(evaluate({ "arrangement.lienStatus": "none" }).state("consignor_lien_payoff_authorization")).toBe(
      "NOT_REQUIRED",
    );
    const lien = evaluate({ "arrangement.lienStatus": "lien" });
    expect(lien.state("consignor_lien_payoff_authorization")).toBe("REQUIRED");
    expect(lien.state("lien_payoff_statement")).toBe("REQUIRED");
    expect(lien.state("lien_release")).toBe("REQUIRED");
  });
});

describe("the 2026-10-01 cancellation cut-over", () => {
  it("a $38,500 sale on 2026-09-20 gets the Contract Cancellation Option, not the 3-Day notice", () => {
    const r = evaluate({ "sale.saleDate": "2026-09-20", "sale.agreedPrice": 38500 });
    expect(r.state("contract_cancellation_option")).toBe("REQUIRED");
    expect(r.state("three_day_right_to_cancel")).toBe("NOT_REQUIRED");
  });

  it("the same sale on 2026-10-05 swaps to the 3-Day notice", () => {
    const r = evaluate({ "sale.saleDate": "2026-10-05", "sale.agreedPrice": 38500 });
    expect(r.state("contract_cancellation_option")).toBe("NOT_REQUIRED");
    expect(r.state("three_day_right_to_cancel")).toBe("REQUIRED");
  });

  it("a $52,000 sale after the cut-over gets neither — both have price ceilings", () => {
    const r = evaluate({ "sale.saleDate": "2026-10-05", "sale.agreedPrice": 52000 });
    expect(r.state("contract_cancellation_option")).toBe("NOT_REQUIRED");
    expect(r.state("three_day_right_to_cancel")).toBe("NOT_REQUIRED");
  });

  it("holds the boundary: 2026-09-30 is the old rule, 2026-10-01 the new one", () => {
    expect(evaluate({ "sale.saleDate": "2026-09-30" }).state("contract_cancellation_option")).toBe("REQUIRED");
    expect(evaluate({ "sale.saleDate": "2026-10-01" }).state("contract_cancellation_option")).toBe("NOT_REQUIRED");
    expect(evaluate({ "sale.saleDate": "2026-10-01" }).state("three_day_right_to_cancel")).toBe("REQUIRED");
  });

  it("does not let the time of day drag a sale across the boundary", () => {
    // A contract written up at 5pm Pacific on 2026-09-30 is already 2026-10-01
    // in UTC. Storing that instant raw would hand the deal the wrong statutory
    // notice, so every write normalises it to the dealership's calendar day.
    const lateOnTheThirtieth = new Date("2026-09-30T17:00:00-07:00");
    expect(dealershipDayString(lateOnTheThirtieth)).toBe("2026-09-30");
    expect(readDay(storeDay(lateOnTheThirtieth))).toBe("2026-09-30");

    const r = evaluate({ "sale.saleDate": storeDay(lateOnTheThirtieth) });
    expect(r.state("contract_cancellation_option")).toBe("REQUIRED");
    expect(r.state("three_day_right_to_cancel")).toBe("NOT_REQUIRED");
  });

  it("keeps a date typed into a form on the day it was typed", () => {
    // The other direction of the same trap: a date input posts "2026-10-01",
    // which as midnight UTC is still 2026-09-30 in Pacific time.
    expect(readDay(storeDay("2026-10-01"))).toBe("2026-10-01");
    const r = evaluate({ "sale.saleDate": storeDay("2026-10-01") });
    expect(r.state("three_day_right_to_cancel")).toBe("REQUIRED");
  });

  it("swaps the purchase agreement version across the same date", () => {
    expect(evaluate({ "sale.saleDate": "2026-09-20" }).state("purchase_agreement")).toBe("REQUIRED");
    expect(evaluate({ "sale.saleDate": "2026-09-20" }).state("purchase_agreement_v2_cars")).toBe("NOT_REQUIRED");
    expect(evaluate({ "sale.saleDate": "2026-10-05" }).state("purchase_agreement")).toBe("NOT_REQUIRED");
    expect(evaluate({ "sale.saleDate": "2026-10-05" }).state("purchase_agreement_v2_cars")).toBe("REQUIRED");
  });

  it("only asks for the add-on disclosure after the cut-over and only when add-ons were sold", () => {
    expect(evaluate({ "sale.saleDate": "2026-10-05", "sale.hasAddOns": true }).state("add_on_disclosure")).toBe(
      "REQUIRED",
    );
    expect(evaluate({ "sale.saleDate": "2026-10-05", "sale.hasAddOns": false }).state("add_on_disclosure")).toBe(
      "NOT_REQUIRED",
    );
    expect(evaluate({ "sale.saleDate": "2026-09-20", "sale.hasAddOns": true }).state("add_on_disclosure")).toBe(
      "NOT_REQUIRED",
    );
  });
});

describe("vehicle age", () => {
  it("a 1957 car is odometer-exempt and smog-exempt but still needs a Buyers Guide", () => {
    const r = evaluate({ "vehicle.year": 1957, "vehicle.ageAtSaleModelYears": 2026 - 1957 });
    expect(r.state("odometer_disclosure")).toBe("NOT_REQUIRED");
    expect(r.state("smog_certificate")).toBe("NOT_REQUIRED");
    expect(r.state("buyers_guide")).toBe("REQUIRED");
  });

  it("a 2015 car needs both the odometer disclosure and a smog certificate for CA registration", () => {
    const r = evaluate({
      "vehicle.year": 2015,
      "vehicle.ageAtSaleModelYears": 2026 - 2015,
      "sale.registrationState": "CA",
    });
    expect(r.state("odometer_disclosure")).toBe("REQUIRED");
    expect(r.state("smog_certificate")).toBe("REQUIRED");
  });

  it("holds the odometer boundary at model year 2011 and at 20 model years", () => {
    expect(evaluate({ "vehicle.year": 2010, "vehicle.ageAtSaleModelYears": 16 }).state("odometer_disclosure")).toBe(
      "NOT_REQUIRED",
    );
    expect(evaluate({ "vehicle.year": 2011, "vehicle.ageAtSaleModelYears": 15 }).state("odometer_disclosure")).toBe(
      "REQUIRED",
    );
    // Twenty model years old drops out again, even for a 2011-or-later car.
    expect(evaluate({ "vehicle.year": 2011, "vehicle.ageAtSaleModelYears": 20 }).state("odometer_disclosure")).toBe(
      "NOT_REQUIRED",
    );
  });

  it("exempts electric and pre-1998 diesel from smog", () => {
    expect(
      evaluate({ "vehicle.year": 2015, "vehicle.ageAtSaleModelYears": 11, "vehicle.fuelType": "ELECTRIC" }).state(
        "smog_certificate",
      ),
    ).toBe("NOT_REQUIRED");
    expect(
      evaluate({ "vehicle.year": 1995, "vehicle.ageAtSaleModelYears": 31, "vehicle.fuelType": "DIESEL" }).state(
        "smog_certificate",
      ),
    ).toBe("NOT_REQUIRED");
    expect(
      evaluate({ "vehicle.year": 2005, "vehicle.ageAtSaleModelYears": 21, "vehicle.fuelType": "DIESEL" }).state(
        "smog_certificate",
      ),
    ).toBe("REQUIRED");
  });
});

describe("motorcycles", () => {
  it("needs neither a Buyers Guide nor a smog certificate", () => {
    const r = evaluate({
      "vehicle.isMotorcycle": true,
      "vehicle.year": 1978,
      "vehicle.ageAtSaleModelYears": 48,
    });
    expect(r.state("buyers_guide")).toBe("NOT_REQUIRED");
    expect(r.state("smog_certificate")).toBe("NOT_REQUIRED");
    // Still a sale: the report of sale and the title do not care what it is.
    expect(r.state("reg_51_report_of_sale")).toBe("REQUIRED");
    expect(r.state("original_title")).toBe("REQUIRED");
  });
});

describe("out-of-state buyers", () => {
  it("common-carrier delivery out of state requires the CDTFA-448 and transport documents", () => {
    const r = evaluate({
      "sale.deliveryState": "NV",
      "sale.registrationState": "NV",
      "sale.deliveryMethod": "COMMON_CARRIER",
      "sale.buyerState": "NV",
      "vehicle.year": 2015,
      "vehicle.ageAtSaleModelYears": 11,
    });
    expect(r.state("cdtfa_448_delivery_outside_ca")).toBe("REQUIRED");
    expect(r.state("transport_documents")).toBe("REQUIRED");
    expect(r.state("out_of_state_bill_of_sale")).toBe("REQUIRED");
    // Smog is a California-registration obligation; NV registration drops it.
    expect(r.state("smog_certificate")).toBe("NOT_REQUIRED");
  });

  it("the same buyer picking the car up here does not get a CDTFA-448", () => {
    const r = evaluate({
      "sale.deliveryState": "CA",
      "sale.registrationState": "NV",
      "sale.deliveryMethod": "BUYER_PICKUP",
      "sale.buyerState": "NV",
    });
    expect(r.state("cdtfa_448_delivery_outside_ca")).toBe("NOT_REQUIRED");
    expect(r.state("transport_documents")).toBe("NOT_REQUIRED");
    // The home-state bill of sale still applies — that follows registration.
    expect(r.state("out_of_state_bill_of_sale")).toBe("REQUIRED");
  });

  it("requires a REG 31 verification for an out-of-state title being registered in CA", () => {
    expect(
      evaluate({ "arrangement.titleState": "AZ", "sale.registrationState": "CA" }).state(
        "reg_31_verification_of_vehicle",
      ),
    ).toBe("REQUIRED");
    expect(
      evaluate({ "arrangement.titleState": "CA", "sale.registrationState": "CA" }).state(
        "reg_31_verification_of_vehicle",
      ),
    ).toBe("NOT_REQUIRED");
  });
});

describe("title condition", () => {
  it("generates a REG 227 for a missing California title", () => {
    const r = evaluate({ "arrangement.titleStatus": "missing", "arrangement.titleState": "CA" });
    expect(r.state("reg_227_duplicate_title")).toBe("REQUIRED");
  });

  it("does not generate a REG 227 for a missing out-of-state title — that duplicate comes from the issuing state", () => {
    const r = evaluate({ "arrangement.titleStatus": "missing", "arrangement.titleState": "OR" });
    expect(r.state("reg_227_duplicate_title")).toBe("NOT_REQUIRED");
    expect(r.reason("reg_227_duplicate_title")).toContain("OR");
  });

  it("falls back to a REG 135 when the title has no price field or the seller name does not match", () => {
    expect(evaluate({ "title.hasPriceField": false }).state("reg_135_bill_of_sale")).toBe("REQUIRED");
    expect(evaluate({ "title.sellerNameMatches": false }).state("reg_135_bill_of_sale")).toBe("REQUIRED");
    expect(evaluate().state("reg_135_bill_of_sale")).toBe("NOT_REQUIRED");
  });

  it("moves the transfer onto a REG 262 when reassignment space has run out", () => {
    expect(evaluate({ "title.reassignmentSpaceAvailable": false }).state("reg_262_reassignment")).toBe("REQUIRED");
  });
});

describe("payments and language", () => {
  it("requires IRS Form 8300 when cash of $10,000 or more was taken", () => {
    expect(evaluate({ "sale.paymentIncludesCashOver10k": true }).state("irs_8300")).toBe("REQUIRED");
    expect(evaluate({ "sale.paymentIncludesCashOver10k": false }).state("irs_8300")).toBe("NOT_REQUIRED");
  });

  it("requires the Spanish Buyers Guide when the deal was negotiated in Spanish", () => {
    expect(evaluate({ "sale.negotiatedLanguage": "ES" }).state("buyers_guide_spanish")).toBe("REQUIRED");
    expect(evaluate({ "sale.negotiatedLanguage": "EN" }).state("buyers_guide_spanish")).toBe("NOT_REQUIRED");
  });

  it("requires the outside-lender package only with third-party financing", () => {
    expect(evaluate({ "sale.outsideLender": true }).state("outside_lender_package")).toBe("REQUIRED");
    expect(evaluate({ "sale.outsideLender": false }).state("outside_lender_package")).toBe("NOT_REQUIRED");
  });

  it("requires a title brand disclosure only when the vehicle carries a brand", () => {
    expect(evaluate({ "vehicle.titleBrand": "SALVAGE" }).state("title_brand_disclosure")).toBe("REQUIRED");
    // A clean title is an absent brand, and `exists` must read that as "no",
    // not as "we don't know" — otherwise every clean car blocks completion.
    expect(evaluate().state("title_brand_disclosure")).toBe("NOT_REQUIRED");
  });
});

describe("unknowns", () => {
  it("a missing delivery state yields UNKNOWN, never a silent no", () => {
    const results = without("sale.deliveryState");
    const cdtfa = results.find((r) => r.key === "cdtfa_448_delivery_outside_ca")!;
    expect(cdtfa.state).toBe("UNKNOWN");
    expect(cdtfa.reason).toBe("Needs: delivery state");
    expect(cdtfa.missing).toEqual(["sale.deliveryState"]);
  });

  it("a missing sale date makes the date-windowed documents UNKNOWN", () => {
    const results = without("sale.saleDate");
    for (const key of ["contract_cancellation_option", "three_day_right_to_cancel", "purchase_agreement"]) {
      const row = results.find((r) => r.key === key)!;
      expect(row.state, key).toBe("UNKNOWN");
      expect(row.reason, key).toContain("sale date");
    }
  });

  it("names every unanswered field at once rather than one at a time", () => {
    const ctx = baseContext();
    delete ctx["arrangement.titleState"];
    delete ctx["sale.registrationState"];
    const reg31 = evaluateRules(ctx, templates).find((r) => r.key === "reg_31_verification_of_vehicle")!;
    expect(reg31.state).toBe("UNKNOWN");
    expect(reg31.reason).toContain("title issuing state");
    expect(reg31.reason).toContain("registration state");
  });

  it("still answers when one branch is unknown but another already settles it", () => {
    // `any` short-circuits on a true branch: REG 256 is required because the
    // odometer is not actual, whatever the unanswered delivery state turns out
    // to be. Reporting UNKNOWN here would be needlessly unhelpful.
    const ctx = baseContext({ "vehicle.mileageStatus": "TMU" });
    delete ctx["sale.deliveryState"];
    const reg256 = evaluateRules(ctx, templates).find((r) => r.key === "reg_256_statement_of_facts")!;
    expect(reg256.state).toBe("REQUIRED");
  });

  it("an `all` that already has a false branch is settled, not unknown", () => {
    // Dealer purchase makes the consignment lien authorization impossible
    // regardless of what the unanswered lien status turns out to be.
    const ctx = baseContext({ "episode.dealType": "DEALER_PURCHASE" });
    delete ctx["arrangement.lienStatus"];
    const row = evaluateRules(ctx, templates).find((r) => r.key === "consignor_lien_payoff_authorization")!;
    expect(row.state).toBe("NOT_REQUIRED");
  });
});

describe("derived values", () => {
  it("derives the odometer flag from the odometer rule, so REG 262 follows it", () => {
    const modern = evaluate({
      "vehicle.year": 2015,
      "vehicle.ageAtSaleModelYears": 11,
      "title.reassignmentSpaceAvailable": true,
      "arrangement.titleState": "CA",
    });
    expect(modern.state("odometer_disclosure")).toBe("REQUIRED");
    expect(modern.state("reg_262_reassignment")).toBe("REQUIRED");
  });

  it("derives the smog exemption, which is what pulls in the REG 256 on an exempt car", () => {
    const classic = evaluate({ "vehicle.year": 1957, "vehicle.ageAtSaleModelYears": 69 });
    expect(classic.state("smog_certificate")).toBe("NOT_REQUIRED");
    expect(classic.state("reg_256_statement_of_facts")).toBe("REQUIRED");
  });

  it("lets an explicit answer override the derived smog exemption", () => {
    const r = evaluate({
      "vehicle.year": 1957,
      "vehicle.ageAtSaleModelYears": 69,
      "manual.smogExemptionClaimed": false,
      "sale.deliveryState": "CA",
      "vehicle.mileageStatus": "ACTUAL",
    });
    expect(r.state("reg_256_statement_of_facts")).toBe("NOT_REQUIRED");
  });
});

describe("reason text", () => {
  it("reads as a sentence an employee can act on", () => {
    const r = evaluate({ "sale.saleDate": "2026-09-20", "sale.agreedPrice": 38500 });
    expect(r.reason("contract_cancellation_option")).toBe(
      "Sale date 2026-09-20 < 2026-10-01 and Sale price $38,500 < $40,000",
    );
  });

  it("explains a not-required answer with the value that settled it", () => {
    const r = evaluate({ "sale.agreedPrice": 52000, "sale.saleDate": "2026-10-05" });
    expect(r.reason("three_day_right_to_cancel")).toContain("$52,000");
    expect(r.reason("three_day_right_to_cancel")).toContain("not ≤ $50,000");
  });

  it("says which window a document fell outside of", () => {
    expect(evaluate({ "sale.saleDate": "2026-10-05" }).reason("purchase_agreement")).toContain("Superseded after");
    expect(evaluate({ "sale.saleDate": "2026-09-20" }).reason("purchase_agreement_v2_cars")).toContain(
      "Not in effect until",
    );
  });
});

describe("always-on documents", () => {
  it("every sale gets the report of sale, title, temp plate, NMVTIS and buyer ID", () => {
    const r = evaluate();
    for (const key of [
      "reg_51_report_of_sale",
      "original_title",
      "temp_registration_eros",
      "nmvtis_report",
      "buyer_id_copy",
      "purchase_agreement",
      "buyer_receipt",
    ]) {
      expect(r.state(key), key).toBe("REQUIRED");
    }
  });

  it("keeps the As-Is Acknowledgment as its own signed document", () => {
    // Jade's call, 2026-09-05: a separate page rather than relying on the
    // Buyers Guide and purchase agreement carrying the language.
    expect(evaluate().state("as_is_acknowledgment")).toBe("REQUIRED");
  });

  it("asks for a Due Bill only when something was promised", () => {
    expect(evaluate({ "sale.hasDueBillItems": true }).state("due_bill")).toBe("REQUIRED");
    expect(evaluate({ "sale.hasDueBillItems": false }).state("due_bill")).toBe("NOT_REQUIRED");
  });
});
