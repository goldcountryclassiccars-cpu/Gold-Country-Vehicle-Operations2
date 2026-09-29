/**
 * "Send for signature" end to end, against the database with the offline
 * signing provider: which checklist rows go out, the refusals staff see,
 * signing progress ticking the checklist, the signed packet filed on the
 * deal, cancel and resend — plus the live-provider rule that a watermarked
 * demonstration copy never goes to a real buyer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { storeDay } from "@/lib/dealership-date";
import {
  BoldSignProvider,
  MockSigningProvider,
  setSigningProviderForTests,
} from "@/lib/adapters/signing";
import { createSale, updateSaleDocumentInputs } from "@/modules/sales/service";
import { generateDocument } from "@/modules/documents/service";
import { saleComplianceSummary } from "@/modules/documents/requirements";
import {
  cancelEnvelope,
  EsignError,
  handleProviderEvent,
  packetCandidates,
  sendForSignature,
  syncEnvelope,
} from "@/modules/esign/service";

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
let jadeId: string;
let mock: MockSigningProvider;
const episodeIds: string[] = [];
const vehicleIds: string[] = [];
const saleIds: string[] = [];
const partyIds: string[] = [];

async function makeDeal(opts: { buyerEmail?: string | null; coBuyerEmail?: string | null; price?: number } = {}) {
  const vehicle = await db.vehicle.create({
    data: { make: "ZZTestMake", model: "ZZTestModel", year: 1969, mileageStatus: "EXEMPT", fuelType: "GAS" },
  });
  vehicleIds.push(vehicle.id);
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId: vehicle.id,
      stockNumber: `ZZTEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      dealType: "DEALER_PURCHASE",
      askingPrice: 40000,
    },
  });
  episodeIds.push(episode.id);
  const sale = await createSale(admin, {
    episodeId: episode.id,
    agreedPrice: opts.price ?? 38500,
    buyer: { displayName: "ZZTest Buyer", state: "CA", email: opts.buyerEmail === undefined ? "zz-buyer@example.com" : opts.buyerEmail },
  });
  saleIds.push(sale.id);
  partyIds.push(sale.buyerPartyId);
  if (opts.coBuyerEmail !== undefined) {
    const co = await db.party.create({
      data: { kind: "PERSON", displayName: "ZZTest CoBuyer", email: opts.coBuyerEmail, createdById: admin.id },
    });
    partyIds.push(co.id);
    await db.saleTransaction.update({ where: { id: sale.id }, data: { coBuyerPartyId: co.id } });
  }
  await updateSaleDocumentInputs(admin, sale.id, {
    saleDate: storeDay("2026-10-05"),
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

async function templateId(key: string) {
  return (await db.documentTemplate.findUniqueOrThrow({ where: { key } })).id;
}

async function row(saleId: string, key: string) {
  return (await saleComplianceSummary(saleId)).rows.find((r) => r.key === key)!;
}

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const rose = await db.user.findUniqueOrThrow({ where: { email: "sales@demo.gccc" } });
  jadeId = jade.id;
  admin = sessionUserFor("admin", jade);
  frontDesk = sessionUserFor("front_desk", rose);
});

beforeEach(() => {
  mock = new MockSigningProvider();
  setSigningProviderForTests(mock);
});

afterAll(async () => {
  setSigningProviderForTests(null);
  const envs = await db.signatureEnvelope.findMany({ where: { saleId: { in: saleIds } } });
  const fileIds = envs.flatMap((e) => [e.signedFileId, e.auditFileId]).filter((x): x is string => Boolean(x));
  await db.signatureEnvelope.deleteMany({ where: { saleId: { in: saleIds } } });
  const docs = await db.documentInstance.findMany({ where: { saleId: { in: saleIds } } });
  await db.saleDocumentRequirement.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.documentInstance.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.fileObject.deleteMany({ where: { id: { in: [...fileIds, ...docs.map((d) => d.fileId)] } } });
  await db.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await db.statusChange.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.inventoryEpisode.deleteMany({ where: { id: { in: episodeIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
  await db.party.deleteMany({ where: { id: { in: partyIds } } });
});

describe("what goes out", () => {
  it("lists the deal's e-signable documents and says what's missing", async () => {
    const sale = await makeDeal();
    const before = await packetCandidates(sale.id);
    const pa = before.find((c) => c.templateKey === "purchase_agreement_v2_cars")!;
    const three = before.find((c) => c.templateKey === "three_day_right_to_cancel")!;
    expect(pa.ready).toBe(false);
    expect(pa.reason).toMatch(/Produce it/);
    expect(three).toBeDefined(); // sale on 10/05 at $38,500: the 3-day notice applies
    expect(before.every((c) => c.templateKey !== "contract_cancellation_option")).toBe(true);
    // Consignor paperwork never goes into a buyer's packet.
    const consignorKeys = (await db.documentTemplate.findMany({ where: { signers: { has: "CONSIGNOR" } }, select: { key: true } })).map((t) => t.key);
    expect(consignorKeys.length).toBeGreaterThan(0);
    expect(before.some((c) => consignorKeys.includes(c.templateKey))).toBe(false);

    await generateDocument(admin, sale.id, await templateId("purchase_agreement_v2_cars"));
    const after = await packetCandidates(sale.id);
    expect(after.find((c) => c.templateKey === "purchase_agreement_v2_cars")!.ready).toBe(true);
  });

  it("never sends a demonstration copy through a live provider", async () => {
    const sale = await makeDeal();
    await generateDocument(admin, sale.id, await templateId("purchase_agreement_v2_cars"));
    setSigningProviderForTests(new BoldSignProvider("k", "https://api.boldsign.com", async () => new Response(null, { status: 500 })));
    const pa = (await packetCandidates(sale.id)).find((c) => c.templateKey === "purchase_agreement_v2_cars")!;
    expect(pa.ready).toBe(false);
    expect(pa.reason).toMatch(/demonstration copy/);
  });
});

describe("refusals staff can act on", () => {
  it("needs the buyer's email, a co-buyer's own email, and a dealer signer", async () => {
    const noEmail = await makeDeal({ buyerEmail: null });
    await generateDocument(admin, noEmail.id, await templateId("purchase_agreement_v2_cars"));
    await expect(sendForSignature(admin, noEmail.id, { dealerUserId: jadeId })).rejects.toThrow(/email address/);

    const sameEmail = await makeDeal({ coBuyerEmail: "zz-buyer@example.com" });
    await generateDocument(admin, sameEmail.id, await templateId("purchase_agreement_v2_cars"));
    await expect(sendForSignature(admin, sameEmail.id, { dealerUserId: jadeId })).rejects.toThrow(/different email/);

    const ok = await makeDeal();
    await generateDocument(admin, ok.id, await templateId("purchase_agreement_v2_cars"));
    await expect(sendForSignature(admin, ok.id, { dealerUserId: frontDesk.id })).rejects.toThrow(/signs for the dealership/);
  });

  it("refuses when nothing has been produced", async () => {
    const sale = await makeDeal();
    await expect(sendForSignature(admin, sale.id, { dealerUserId: jadeId })).rejects.toThrow(EsignError);
  });
});

describe("the signing lifecycle", () => {
  it("sends one packet, ticks the checklist as people sign, and files the signed copy", async () => {
    const sale = await makeDeal({ coBuyerEmail: "zz-cobuyer@example.com" });
    await generateDocument(admin, sale.id, await templateId("purchase_agreement_v2_cars"));
    await generateDocument(admin, sale.id, await templateId("three_day_right_to_cancel"));

    // Front Desk can send; Jade countersigns.
    const env = await sendForSignature(frontDesk, sale.id, { dealerUserId: jadeId });
    expect(mock.sent).toHaveLength(1);
    const req = mock.sent[0]!;
    expect(req.signers.map((s) => [s.role, s.order])).toEqual([
      ["BUYER", 1],
      ["CO_BUYER", 1],
      ["DEALER", 2],
    ]);
    expect(req.signers.every((s) => s.fields.some((f) => f.type === "Signature"))).toBe(true);
    expect(env.documentInstanceIds).toHaveLength(2);
    expect(req.metadata.saleId).toBe(sale.id);

    // A second send while this one is out is refused.
    await expect(sendForSignature(frontDesk, sale.id, { dealerUserId: jadeId })).rejects.toThrow(/already out/);

    // The buyer signs, then the co-buyer: only then is "buyer signed" ticked.
    mock.simulateSigned(env.externalId, "zz-buyer@example.com");
    await syncEnvelope(env.id, null);
    expect((await row(sale.id, "purchase_agreement_v2_cars")).progress.buyerSigned).toBe(false);

    mock.simulateSigned(env.externalId, "zz-cobuyer@example.com");
    await handleProviderEvent(env.externalId); // what the webhook does
    expect((await row(sale.id, "purchase_agreement_v2_cars")).progress.buyerSigned).toBe(true);
    expect((await row(sale.id, "three_day_right_to_cancel")).progress.buyerSigned).toBe(true);
    expect((await row(sale.id, "purchase_agreement_v2_cars")).progress.dealerSigned).toBe(false);
    const partial = await db.documentInstance.findMany({ where: { id: { in: env.documentInstanceIds } } });
    expect(partial.every((d) => d.status === "PARTIALLY_SIGNED")).toBe(true);

    // Jade countersigns: the envelope completes and the signed packet is filed.
    mock.simulateSigned(env.externalId, "jade@demo.gccc");
    const done = await syncEnvelope(env.id, null);
    expect(done.status).toBe("COMPLETED");
    expect(done.signedFileId).toBeTruthy();
    expect(done.auditFileId).toBeTruthy();
    expect((await row(sale.id, "purchase_agreement_v2_cars")).progress.dealerSigned).toBe(true);
    const signedDocs = await db.documentInstance.findMany({ where: { id: { in: env.documentInstanceIds } } });
    expect(signedDocs.every((d) => d.status === "SIGNED" && d.fileId === done.signedFileId)).toBe(true);

    // Idempotent: a repeated webhook changes nothing.
    const again = await syncEnvelope(env.id, null);
    expect(again.signedFileId).toBe(done.signedFileId);
    const audits = await db.auditEvent.count({ where: { resourceId: sale.id, action: "esign.status" } });
    await handleProviderEvent(env.externalId);
    expect(await db.auditEvent.count({ where: { resourceId: sale.id, action: "esign.status" } })).toBe(audits);
  });

  it("cancel puts the documents back so a corrected packet can go out", async () => {
    const sale = await makeDeal();
    await generateDocument(admin, sale.id, await templateId("purchase_agreement_v2_cars"));
    const env = await sendForSignature(admin, sale.id, { dealerUserId: jadeId });
    await cancelEnvelope(admin, env.id, "Correcting the price");
    const docs = await db.documentInstance.findMany({ where: { id: { in: env.documentInstanceIds } } });
    expect(docs.every((d) => d.status === "GENERATED" && d.envelopeExternalId === null)).toBe(true);
    const second = await sendForSignature(admin, sale.id, { dealerUserId: jadeId });
    expect(second.id).not.toBe(env.id);
  });

  it("a buyer declining ends the request and frees the documents", async () => {
    const sale = await makeDeal();
    await generateDocument(admin, sale.id, await templateId("purchase_agreement_v2_cars"));
    const env = await sendForSignature(admin, sale.id, { dealerUserId: jadeId });
    mock.simulate(env.externalId, "declined");
    const ended = await syncEnvelope(env.id, null);
    expect(ended.status).toBe("DECLINED");
    expect(ended.endedReason).toMatch(/declined/);
    expect((await packetCandidates(sale.id)).find((c) => c.templateKey === "purchase_agreement_v2_cars")!.ready).toBe(true);
  });

  it("ignores webhooks for documents it didn't send", async () => {
    await expect(handleProviderEvent("not-ours")).resolves.toEqual({ handled: false });
    await expect(handleProviderEvent(null)).resolves.toEqual({ handled: false });
  });
});
