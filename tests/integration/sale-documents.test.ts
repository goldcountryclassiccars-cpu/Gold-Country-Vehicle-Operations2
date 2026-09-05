/**
 * Integration tests for sale-document requirements and the sequencing rules.
 *
 * Fixtures use synthetic identifiers (ZZTEST…) throughout — an earlier draft in
 * this project used a real chassis number from Jade's inventory and the tests
 * broke the moment that car existed in the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { AuthzError } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { storeDay } from "@/lib/dealership-date";
import {
  assertMileageKnown,
  cancellationWindowFrom,
  completeSale,
  createSale,
  deliverVehicle,
  markContracted,
  recordPayment,
  releaseVehicle,
  SalesError,
  updateSaleDocumentInputs,
} from "@/modules/sales/service";
import {
  evaluateSaleRequirements,
  isRequirementComplete,
  outstandingSteps,
  overrideRequirement,
  saleComplianceSummary,
  setRequirementStep,
} from "@/modules/documents/requirements";
import { consignorPayoutClock, createSettlement, SettlementError } from "@/modules/settlements/service";

function sessionUserFor(roleKey: string, base: { id: string; name: string; email: string }): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === roleKey)!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: tpl.key,
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  return {
    id: base.id, sessionId: "t", name: base.name, email: base.email, roleKeys: [roleKey],
    isOwner: roleKey === "admin", previewRoleKey: null, departmentIds: [], departmentKeys: [],
    permissions, fieldGrants, defaultLandingPage: null,
  };
}

let admin: SessionUser;
let frontDesk: SessionUser;
const episodeIds: string[] = [];
const vehicleIds: string[] = [];
const saleIds: string[] = [];
const partyIds: string[] = [];

/** A consignment episode with a known odometer, ready to sell. */
async function makeEpisode(over: {
  year?: number;
  isMotorcycle?: boolean;
  dealType?: "CONSIGNMENT" | "DEALER_PURCHASE";
  titleStatus?: string;
  titleState?: string;
  lienStatus?: string;
  mileageStatus?: "ACTUAL" | "UNKNOWN" | "EXEMPT";
} = {}) {
  const vehicle = await db.vehicle.create({
    data: {
      make: "ZZTestMake",
      model: "ZZTestModel",
      year: over.year ?? 1969,
      mileageStatus: over.mileageStatus ?? "ACTUAL",
      isMotorcycle: over.isMotorcycle ?? false,
      fuelType: "GAS",
    },
  });
  vehicleIds.push(vehicle.id);
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId: vehicle.id,
      stockNumber: `ZZTEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      dealType: over.dealType ?? "CONSIGNMENT",
      askingPrice: 40000,
    },
  });
  episodeIds.push(episode.id);
  const consignor = await db.party.create({
    data: { kind: "PERSON", displayName: "ZZTest Consignor", createdById: admin.id },
  });
  partyIds.push(consignor.id);
  await db.arrangement.create({
    data: {
      episodeId: episode.id,
      sellerPartyId: consignor.id,
      titleStatus: over.titleStatus ?? "present",
      titleState: over.titleState ?? "CA",
      lienStatus: over.lienStatus ?? "none",
      commissionStructure: { type: "percent", value: 10 },
    },
  });
  return episode;
}

/** A sale with every rule input answered, so nothing is UNKNOWN. */
async function makeAnsweredSale(episodeId: string, price = 38500, saleDate = "2026-09-20") {
  const sale = await createSale(admin, {
    episodeId,
    agreedPrice: price,
    buyer: { displayName: "ZZTest Buyer", state: "CA" },
  });
  saleIds.push(sale.id);
  partyIds.push(sale.buyerPartyId);
  await updateSaleDocumentInputs(admin, sale.id, {
    saleDate: storeDay(saleDate),
    deliveryState: "CA",
    deliveryMethod: "BUYER_PICKUP",
    registrationState: "CA",
    outsideLender: false,
    negotiatedLanguage: "EN",
    odometerAtSale: 54321,
    salesTaxCollected: 3200,
    manualAnswers: {
      "title.hasPriceField": true,
      "title.sellerNameMatches": true,
      "title.reassignmentSpaceAvailable": true,
      "manual.reg256Needed": false,
      "manual.reg135Needed": false,
      "manual.consignorPOA": false,
      "manual.buyerPOA": false,
      "sale.hasDueBillItems": false,
      "sale.hasAddOns": false,
    },
  });
  return sale;
}

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const rose = await db.user.findUniqueOrThrow({ where: { email: "sales@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  frontDesk = sessionUserFor("front_desk", rose);
});

afterAll(async () => {
  await db.saleDocumentRequirement.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.settlement.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await db.statusChange.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.arrangement.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.inventoryEpisode.deleteMany({ where: { id: { in: episodeIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
  await db.party.deleteMany({ where: { id: { in: partyIds } } });
});

describe("the odometer gate", () => {
  it("refuses to open a deal while the odometer status is UNKNOWN", async () => {
    const episode = await makeEpisode({ mileageStatus: "UNKNOWN" });
    await expect(assertMileageKnown(episode.id)).rejects.toThrow(SalesError);
    await expect(
      createSale(admin, { episodeId: episode.id, agreedPrice: 30000, buyer: { displayName: "ZZTest Blocked" } }),
    ).rejects.toThrow(/odometer status/i);
  });

  it("lets the deal through once the status is corrected on the vehicle record", async () => {
    const episode = await makeEpisode({ mileageStatus: "UNKNOWN" });
    await db.vehicle.update({ where: { id: episode.vehicleId }, data: { mileageStatus: "EXEMPT" } });
    const sale = await createSale(admin, {
      episodeId: episode.id,
      agreedPrice: 30000,
      buyer: { displayName: "ZZTest Allowed" },
    });
    saleIds.push(sale.id);
    partyIds.push(sale.buyerPartyId);
    expect(sale.status).toBe("DEPOSIT_REQUESTED");
  });
});

describe("evaluating a sale", () => {
  it("writes a requirement row for every active template and explains each one", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    const summary = await saleComplianceSummary(sale.id);

    const templateCount = await db.documentTemplate.count({ where: { active: true } });
    expect(summary.rows).toHaveLength(templateCount);
    expect(summary.rows.every((r) => r.reason.length > 0)).toBe(true);

    const cancellation = summary.rows.find((r) => r.key === "contract_cancellation_option")!;
    expect(cancellation.state).toBe("REQUIRED");
    expect(cancellation.reason).toContain("$38,500");
  });

  it("re-evaluates when the vehicle changes underneath an open deal", async () => {
    const episode = await makeEpisode({ year: 2015 });
    const sale = await makeAnsweredSale(episode.id);
    const before = await saleComplianceSummary(sale.id);
    expect(before.rows.find((r) => r.key === "buyers_guide")!.state).toBe("REQUIRED");

    const { updateVehicle } = await import("@/modules/vehicles/service");
    await updateVehicle(admin, episode.vehicleId, { isMotorcycle: true });

    const after = await saleComplianceSummary(sale.id);
    expect(after.rows.find((r) => r.key === "buyers_guide")!.state).toBe("NOT_REQUIRED");
    expect(after.rows.find((r) => r.key === "smog_certificate")!.state).toBe("NOT_REQUIRED");
  });

  it("re-evaluates when a cash payment crosses $10,000", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    expect((await saleComplianceSummary(sale.id)).rows.find((r) => r.key === "irs_8300")!.state).toBe("NOT_REQUIRED");

    await recordPayment(admin, { saleId: sale.id, kind: "DEPOSIT", method: "CASH", amount: 12000 });
    expect((await saleComplianceSummary(sale.id)).rows.find((r) => r.key === "irs_8300")!.state).toBe("REQUIRED");
  });

  it("marks a requirement not-required rather than deleting the row", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    const before = await db.saleDocumentRequirement.count({ where: { saleId: sale.id } });

    await updateSaleDocumentInputs(admin, sale.id, { registrationState: "NV", deliveryState: "NV" });
    const after = await db.saleDocumentRequirement.count({ where: { saleId: sale.id } });

    expect(after).toBe(before);
    const smog = (await saleComplianceSummary(sale.id)).rows.find((r) => r.key === "smog_certificate")!;
    expect(smog.state).toBe("NOT_REQUIRED");
  });

  it("reports UNKNOWN, not false, while the delivery state is unanswered", async () => {
    const episode = await makeEpisode();
    const sale = await createSale(admin, {
      episodeId: episode.id,
      agreedPrice: 38500,
      buyer: { displayName: "ZZTest Unanswered" },
    });
    saleIds.push(sale.id);
    partyIds.push(sale.buyerPartyId);

    const summary = await saleComplianceSummary(sale.id);
    const cdtfa = summary.rows.find((r) => r.key === "cdtfa_448_delivery_outside_ca")!;
    expect(cdtfa.state).toBe("UNKNOWN");
    expect(cdtfa.reason).toBe("Needs: delivery state");
    expect(summary.unknownCount).toBeGreaterThan(0);
    // An unknown row is a blocker, exactly like a required one.
    expect(summary.blockers.map((b) => b.key)).toContain("cdtfa_448_delivery_outside_ca");
    expect(summary.ok).toBe(false);
  });
});

describe("manual overrides", () => {
  it("survives re-evaluation and keeps the reason", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    const row = await db.saleDocumentRequirement.findFirstOrThrow({
      where: { saleId: sale.id, template: { key: "buyer_receipt" } },
    });
    expect(row.state).toBe("REQUIRED");

    await overrideRequirement(admin, row.id, "NOT_REQUIRED", "Buyer declined a printed receipt, emailed instead");

    // Anything at all that triggers a re-run.
    await updateSaleDocumentInputs(admin, sale.id, { odometerAtSale: 55555 });
    await evaluateSaleRequirements(admin, sale.id);

    const after = await db.saleDocumentRequirement.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.state).toBe("NOT_REQUIRED");
    expect(after.manualOverride).toBe(true);
    expect(after.overrideReason).toContain("emailed instead");
    expect(after.overrideById).toBe(admin.id);
  });

  it("hands the row back to the rules when the override is cleared", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    const row = await db.saleDocumentRequirement.findFirstOrThrow({
      where: { saleId: sale.id, template: { key: "buyer_receipt" } },
    });
    await overrideRequirement(admin, row.id, "NOT_REQUIRED", "Temporarily waived for this deal");
    await overrideRequirement(admin, row.id, null, "");

    const after = await db.saleDocumentRequirement.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.manualOverride).toBe(false);
    expect(after.state).toBe("REQUIRED");
  });

  it("is Admin-only — Front Desk may mark steps done but not override", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    const row = await db.saleDocumentRequirement.findFirstOrThrow({
      where: { saleId: sale.id, template: { key: "buyer_receipt" } },
    });

    await expect(overrideRequirement(frontDesk, row.id, "NOT_REQUIRED", "not needed")).rejects.toThrow(AuthzError);
    // The everyday action is still theirs.
    await expect(setRequirementStep(frontDesk, row.id, "dealerSigned", true)).resolves.not.toThrow();
  });

  it("demands a reason", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    const row = await db.saleDocumentRequirement.findFirstOrThrow({
      where: { saleId: sale.id, template: { key: "buyer_receipt" } },
    });
    await expect(overrideRequirement(admin, row.id, "NOT_REQUIRED", "no")).rejects.toThrow(/reason/i);
  });
});

describe("completion steps", () => {
  const template = {
    category: 1,
    signers: ["BUYER", "DEALER"],
    physicalOriginal: false,
    buyerCopy: true,
    retain: true,
    submitTo: null,
  };
  const blank = {
    buyerSigned: false, dealerSigned: false, consignorSigned: false, originalReceived: false,
    submittedAt: null, buyerCopyProvidedAt: null, filedAt: null, lookupAt: null, fileId: null,
    documentInstanceId: null,
  };

  it("names each outstanding step in the words the checklist uses", () => {
    expect(outstandingSteps(template, blank)).toEqual([
      "buyer signature",
      "dealer signature",
      "buyer copy not given",
      "not filed",
    ]);
  });

  it("is complete only once every step the template calls for is done", () => {
    expect(isRequirementComplete(template, blank)).toBe(false);
    expect(
      isRequirementComplete(template, {
        ...blank,
        buyerSigned: true,
        dealerSigned: true,
        buyerCopyProvidedAt: new Date(),
        filedAt: new Date(),
      }),
    ).toBe(true);
  });

  it("treats a third-party document as done when it has been collected", () => {
    const thirdParty = { category: 4, signers: ["NONE"], physicalOriginal: false, buyerCopy: false, retain: false, submitTo: null };
    expect(outstandingSteps(thirdParty, blank)).toEqual(["not collected"]);
    expect(isRequirementComplete(thirdParty, { ...blank, lookupAt: new Date() })).toBe(true);
  });
});

describe("the completion gate", () => {
  it("blocks COMPLETE while any required or unknown row is incomplete", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    await markContracted(admin, sale.id);
    await recordPayment(admin, { saleId: sale.id, kind: "FINAL", method: "WIRE", amount: 38500, status: "CLEARED" });
    await releaseVehicle(admin, sale.id, "ZZTest release for the completion gate test");
    await deliverVehicle(admin, sale.id);

    await expect(completeSale(admin, sale.id)).rejects.toThrow(/outstanding/i);

    const summary = await saleComplianceSummary(sale.id);
    expect(summary.ok).toBe(false);
    expect(summary.headline).toMatch(/of \d+ required items complete/);
  });

  it("allows COMPLETE once every gating row is done, and files the episode", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    await markContracted(admin, sale.id);
    await recordPayment(admin, { saleId: sale.id, kind: "FINAL", method: "WIRE", amount: 38500, status: "CLEARED" });
    await releaseVehicle(admin, sale.id, "ZZTest release for the completion gate test");
    await deliverVehicle(admin, sale.id);

    // Satisfy every gating row the way the checklist would.
    const rows = await db.saleDocumentRequirement.findMany({
      where: { saleId: sale.id, state: { in: ["REQUIRED", "UNKNOWN"] } },
      include: { template: true },
    });
    for (const row of rows) {
      await db.saleDocumentRequirement.update({
        where: { id: row.id },
        data: {
          buyerSigned: true, dealerSigned: true, consignorSigned: true, originalReceived: true,
          submittedAt: new Date(), buyerCopyProvidedAt: new Date(), filedAt: new Date(),
          lookupAt: new Date(), fileId: "zztest-file", complete: true,
        },
      });
    }

    await completeSale(admin, sale.id);
    const after = await db.saleTransaction.findUniqueOrThrow({ where: { id: sale.id } });
    expect(after.status).toBe("COMPLETE");
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(ep.documentStatus).toBe("FILED");
  });

  it("is Admin-only", async () => {
    expect(frontDesk.permissions.get("sales:complete") ?? "NONE").toBe("NONE");
    expect(admin.permissions.get("sales:complete")).toBe("ALL");
    // Overriding a requirement is likewise out of reach for the front desk.
    expect(frontDesk.permissions.get("documents:override_gate") ?? "NONE").toBe("NONE");
  });
});

describe("the consignor payout clock", () => {
  it("computes a cancellation window only for sales on or after 2026-10-01", () => {
    const delivered = new Date("2026-10-05T10:00:00-07:00");
    expect(cancellationWindowFrom(storeDay("2026-09-20"), delivered)).toBeNull();
    const window = cancellationWindowFrom(storeDay("2026-10-05"), delivered);
    expect(window).not.toBeNull();
    expect(window!.getTime()).toBeGreaterThan(delivered.getTime());
  });

  it("holds the payout while the buyer's funds have not cleared", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    await markContracted(admin, sale.id);
    await recordPayment(admin, { saleId: sale.id, kind: "DEPOSIT", method: "WIRE", amount: 5000, status: "RECEIVED" });

    const clock = await consignorPayoutClock(episode.id);
    expect(clock.blockedBy).toMatch(/funds have not cleared/i);
    expect(clock.dueBy).toBeNull();
    await expect(createSettlement(admin, episode.id)).rejects.toThrow(SettlementError);
  });

  it("holds the payout while a cancellation window is still open", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id, 38500, "2026-10-05");
    await markContracted(admin, sale.id);
    await recordPayment(admin, { saleId: sale.id, kind: "FINAL", method: "WIRE", amount: 38500, status: "CLEARED" });
    await db.saleTransaction.update({
      where: { id: sale.id },
      data: { cancellationWindowEndsAt: new Date(Date.now() + 2 * 86400_000) },
    });

    const clock = await consignorPayoutClock(episode.id);
    expect(clock.blockedBy).toMatch(/cancellation window/i);
    await expect(createSettlement(admin, episode.id)).rejects.toThrow(/cancellation window/i);
  });

  it("starts the countdown from when the funds cleared, not from delivery", async () => {
    const episode = await makeEpisode();
    const sale = await makeAnsweredSale(episode.id);
    await markContracted(admin, sale.id);
    await recordPayment(admin, { saleId: sale.id, kind: "FINAL", method: "WIRE", amount: 38500, status: "CLEARED" });

    const clock = await consignorPayoutClock(episode.id);
    expect(clock.blockedBy).toBeNull();
    expect(clock.fundsClearedAt).not.toBeNull();
    expect(clock.dueBy).not.toBeNull();
    // Default AppSetting is 14 days; the car has not been delivered at all yet,
    // so a delivery-anchored clock would still read null here.
    expect(clock.daysRemaining).toBeGreaterThan(0);
    expect(clock.overdue).toBe(false);
  });
});
