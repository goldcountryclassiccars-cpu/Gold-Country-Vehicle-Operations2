/**
 * The Document Library end to end, against the database with the offline
 * signing provider: a standalone send with no sale, the consignor signature
 * role, the refusals staff see (draft template, demo copy on a live provider,
 * wire instructions before a deposit), envelope sync with no checklist, and
 * the deal checklist adopting what was signed before the deal opened.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { BoldSignProvider, MockSigningProvider, setSigningProviderForTests } from "@/lib/adapters/signing";
import { LogEmailAdapter, setEmailAdapterForTests } from "@/lib/adapters/email";
import { uploadApprovedTemplate } from "@/modules/documents/templates";
import { saleComplianceSummary } from "@/modules/documents/requirements";
import { syncEnvelope } from "@/modules/esign/service";
import { createSale } from "@/modules/sales/service";
import { adoptLibraryDocuments, libraryEntries, librarySent, LibraryError, sendFromLibrary } from "@/modules/library/service";

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

/** A one-page fillable PDF with the dealership's named fields for the given roles. */
async function fillablePdf(roles: ("BUYER" | "CONSIGNOR" | "DEALER")[], textFields: string[] = []) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  let y = 700;
  for (const name of textFields) {
    form.createTextField(name).addToPage(page, { x: 60, y, width: 300, height: 18 });
    y -= 30;
  }
  for (const role of roles) {
    form.createTextField(`SIG_${role}`).addToPage(page, { x: 60, y, width: 220, height: 28 });
    form.createTextField(`DATE_${role}`).addToPage(page, { x: 320, y, width: 120, height: 18 });
    y -= 60;
  }
  return Buffer.from(await pdf.save());
}

let admin: SessionUser;
let frontDesk: SessionUser;
let jadeId: string;
let mock: MockSigningProvider;
let mail: LogEmailAdapter;
const episodeIds: string[] = [];
const vehicleIds: string[] = [];
const partyIds: string[] = [];
const saleIds: string[] = [];
const touchedTemplates = new Map<string, string | null>(); // key -> prior approvedFileId

async function makeCar(dealType: "CONSIGNMENT" | "DEALER_PURCHASE" = "CONSIGNMENT", consignorEmail = "zz-consignor@example.com") {
  const vehicle = await db.vehicle.create({
    data: { make: "ZZTestMake", model: "ZZTestModel", year: 1969, mileageStatus: "EXEMPT", fuelType: "GAS" },
  });
  vehicleIds.push(vehicle.id);
  const consignor = await db.party.create({
    data: { kind: "PERSON", displayName: "ZZTest Consignor", email: consignorEmail, city: "Reno", state: "NV", createdById: jadeId },
  });
  partyIds.push(consignor.id);
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId: vehicle.id,
      stockNumber: `ZZTEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      dealType,
      askingPrice: 40000,
      arrangement: { create: { sellerPartyId: consignor.id, agreementStartAt: new Date("2026-09-01T12:00:00Z") } },
    },
  });
  episodeIds.push(episode.id);
  return { episode, consignor };
}

async function approve(key: string, bytes: Buffer) {
  const t = await db.documentTemplate.findUniqueOrThrow({ where: { key } });
  if (!touchedTemplates.has(key)) touchedTemplates.set(key, t.approvedFileId);
  await uploadApprovedTemplate(admin, { templateKey: key, originalName: `${key}.pdf`, contentType: "application/pdf", data: bytes });
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
  mail = new LogEmailAdapter();
  setEmailAdapterForTests(mail);
});

afterAll(async () => {
  setSigningProviderForTests(null);
  setEmailAdapterForTests(null);
  for (const [key, prior] of touchedTemplates) {
    await db.documentTemplate.update({
      where: { key },
      data: { approvedFileId: prior, approvedAt: prior ? undefined : null, approvedById: prior ? undefined : null },
    });
  }
  const envs = await db.signatureEnvelope.findMany({ where: { OR: [{ episodeId: { in: episodeIds } }, { saleId: { in: saleIds } }] } });
  const envFiles = envs.flatMap((e) => [e.signedFileId, e.auditFileId]).filter((x): x is string => Boolean(x));
  await db.signatureEnvelope.deleteMany({ where: { id: { in: envs.map((e) => e.id) } } });
  const docs = await db.documentInstance.findMany({ where: { episodeId: { in: episodeIds } } });
  await db.saleDocumentRequirement.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.documentInstance.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.fileObject.deleteMany({ where: { id: { in: [...envFiles, ...docs.map((d) => d.fileId)] } } });
  await db.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await db.statusChange.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.arrangement.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.inventoryEpisode.deleteMany({ where: { id: { in: episodeIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
  await db.party.deleteMany({ where: { id: { in: partyIds } } });
  await db.party.deleteMany({ where: { email: { startsWith: "zz-" }, displayName: { startsWith: "ZZTest" } } });
});

describe("library entries", () => {
  it("lists the new documents with journey stages and hides the inactive draft", async () => {
    const entries = await libraryEntries();
    const keys = entries.map((e) => e.key);
    expect(keys).toContain("intent_to_purchase");
    expect(keys).toContain("title_custody_addendum");
    expect(keys).toContain("consignment_certification_oos");
    expect(keys).toContain("wire_instructions");
    expect(keys).not.toContain("as_is_sales_contract_ca"); // draft — inactive until counsel approves
    const addendum = entries.find((e) => e.key === "title_custody_addendum")!;
    expect(addendum.journeyStage).toBe("CONSIGN_INTAKE");
    expect(addendum.recipientRole).toBe("CONSIGNOR");
    expect(addendum.blocked).toBeNull();
    const pa = entries.find((e) => e.key === "purchase_agreement_v2_cars")!;
    expect(pa.blocked).toMatch(/deal page/);
  });
});

describe("sendFromLibrary", () => {
  it("front desk sends a consignor document for e-signature with no sale open", async () => {
    const { episode, consignor } = await makeCar();
    await approve("title_custody_addendum", await fillablePdf(["CONSIGNOR", "DEALER"], ["consignor.name", "vehicle.vin", "agreement.date"]));

    const result = await sendFromLibrary(frontDesk, {
      templateKey: "title_custody_addendum",
      episodeId: episode.id,
      partyId: consignor.id,
      method: "ESIGN",
      dealerUserId: jadeId,
    });
    expect(result.kind).toBe("ESIGN");
    expect(mock.sent).toHaveLength(1);
    const req = mock.sent[0]!;
    const roles = req.signers.map((s) => s.role);
    expect(roles).toEqual(["CONSIGNOR", "DEALER"]);
    expect(req.signers[0]!.email).toBe("zz-consignor@example.com");
    expect(req.signers[0]!.fields.length).toBeGreaterThan(0);
    expect(req.signers[1]!.fields.length).toBeGreaterThan(0);

    const env = await db.signatureEnvelope.findUniqueOrThrow({ where: { id: (result as { envelopeId: string }).envelopeId } });
    expect(env.saleId).toBeNull();
    expect(env.episodeId).toBe(episode.id);
    expect(env.partyId).toBe(consignor.id);

    const inst = await db.documentInstance.findUniqueOrThrow({ where: { id: result.instanceId! } });
    expect(inst.saleId).toBeNull();
    expect(inst.partyId).toBe(consignor.id);
    expect(inst.status).toBe("SENT");
    expect(inst.sentVia).toBe("ESIGN");

    // The consignor's name was pre-filled from the arrangement before flattening.
    const sentPdf = await PDFDocument.load(req.pdf);
    expect(sentPdf.getForm().getFields().length).toBe(0); // flattened
    const sent = await librarySent({ episodeId: episode.id });
    expect(sent[0]!.templateKey).toBe("title_custody_addendum");
    expect(sent[0]!.status).toBe("SENT");

    // Everyone signs: the envelope completes with no checklist rows to tick.
    mock.simulateSigned(env.externalId, "zz-consignor@example.com");
    mock.simulateSigned(env.externalId, (await db.user.findUniqueOrThrow({ where: { id: jadeId } })).email);
    const synced = await syncEnvelope(env.id, admin);
    expect(synced.status).toBe("COMPLETED");
    expect(synced.signedFileId).toBeTruthy();
    const signedInst = await db.documentInstance.findUniqueOrThrow({ where: { id: inst.id } });
    expect(signedInst.status).toBe("SIGNED");
  });

  it("emails a pre-filled PDF through the email adapter", async () => {
    const { episode } = await makeCar();
    await approve("intent_to_purchase", await fillablePdf(["BUYER"], ["buyer.name", "vehicle.yearMakeModel"]));
    const result = await sendFromLibrary(frontDesk, {
      templateKey: "intent_to_purchase",
      episodeId: episode.id,
      newParty: { displayName: "ZZTest Lead", email: "zz-lead@example.com" },
      method: "EMAIL_PDF",
    });
    expect(result.kind).toBe("EMAIL_PDF");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("zz-lead@example.com");
    expect(mail.sent[0]!.attachments).toBe(1);
    const inst = await db.documentInstance.findUniqueOrThrow({ where: { id: result.instanceId! } });
    expect(inst.sentVia).toBe("EMAIL_PDF");
    expect(inst.status).toBe("SENT");
    // The stored copy keeps its fields and carries the lead's name.
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: inst.fileId } });
    const { storage } = await import("@/lib/adapters/storage");
    const pdf = await PDFDocument.load(await storage().get(file.storageKey));
    expect(pdf.getForm().getTextField("buyer.name").getText()).toBe("ZZTest Lead");
    expect(pdf.getForm().getTextField("vehicle.yearMakeModel").getText()).toBe("1969 ZZTestMake ZZTestModel");
    const party = await db.party.findFirstOrThrow({ where: { email: "zz-lead@example.com" } });
    partyIds.push(party.id);
  });

  it("refuses the draft template and anything not sendable standalone", async () => {
    const { episode, consignor } = await makeCar();
    await expect(
      sendFromLibrary(admin, { templateKey: "as_is_sales_contract_ca", episodeId: episode.id, partyId: consignor.id, method: "EMAIL_PDF" }),
    ).rejects.toThrow(LibraryError);
    await expect(
      sendFromLibrary(admin, { templateKey: "purchase_agreement_v2_cars", episodeId: episode.id, partyId: consignor.id, method: "EMAIL_PDF" }),
    ).rejects.toThrow(/deal page/);
  });

  it("refuses the demonstration copy on a live provider, and for email even in practice", async () => {
    const { episode, consignor } = await makeCar();
    const prior = await db.documentTemplate.findUniqueOrThrow({ where: { key: "receipt_of_property" } });
    if (!touchedTemplates.has("receipt_of_property")) touchedTemplates.set("receipt_of_property", prior.approvedFileId);
    await db.documentTemplate.update({ where: { key: "receipt_of_property" }, data: { approvedFileId: null } });
    await expect(
      sendFromLibrary(admin, { templateKey: "receipt_of_property", episodeId: episode.id, partyId: consignor.id, method: "EMAIL_PDF" }),
    ).rejects.toThrow(/demonstration/);
    setSigningProviderForTests(new BoldSignProvider("test-key", "https://api.boldsign.com", async () => new Response("{}", { status: 500 })));
    await expect(
      sendFromLibrary(admin, { templateKey: "receipt_of_property", episodeId: episode.id, partyId: consignor.id, method: "ESIGN", dealerUserId: jadeId }),
    ).rejects.toThrow(/demonstration/);
  });

  it("wire instructions go only to a contact with a deposit requested, whoever sends", async () => {
    const { episode } = await makeCar("DEALER_PURCHASE");
    await approve("wire_instructions", await fillablePdf([]));
    await expect(
      sendFromLibrary(frontDesk, {
        templateKey: "wire_instructions",
        episodeId: null,
        newParty: { displayName: "ZZTest Cold Lead", email: "zz-cold@example.com" },
        method: "EMAIL_PDF",
      }),
    ).rejects.toThrow(/deposit/);
    await expect(
      sendFromLibrary(admin, {
        templateKey: "wire_instructions",
        episodeId: null,
        newParty: { displayName: "ZZTest Cold Lead", email: "zz-cold@example.com" },
        method: "EMAIL_PDF",
      }),
    ).rejects.toThrow(/deposit/);

    const sale = await createSale(admin, {
      episodeId: episode.id,
      agreedPrice: 30000,
      buyer: { displayName: "ZZTest Deposit Buyer", email: "zz-deposit@example.com", state: "CA" },
    });
    saleIds.push(sale.id);
    partyIds.push(sale.buyerPartyId);
    const result = await sendFromLibrary(frontDesk, {
      templateKey: "wire_instructions",
      episodeId: null,
      partyId: sale.buyerPartyId,
      method: "EMAIL_PDF",
    });
    expect(result.kind).toBe("EMAIL_PDF");
    expect(mail.sent.at(-1)!.to).toBe("zz-deposit@example.com");
  });

  it("a signed Intent to Purchase is adopted by the deal that opens later", async () => {
    const { episode } = await makeCar("DEALER_PURCHASE");
    await approve("intent_to_purchase", await fillablePdf(["BUYER"], ["buyer.name"]));
    const result = await sendFromLibrary(frontDesk, {
      templateKey: "intent_to_purchase",
      episodeId: episode.id,
      newParty: { displayName: "ZZTest Future Buyer", email: "zz-future@example.com" },
      method: "ESIGN",
    });
    const env = await db.signatureEnvelope.findUniqueOrThrow({ where: { id: (result as { envelopeId: string }).envelopeId } });
    expect(env.saleId).toBeNull();
    mock.simulateSigned(env.externalId, "zz-future@example.com");
    await syncEnvelope(env.id, admin);

    // The deal form creates a fresh Party; the match is on the email.
    const sale = await createSale(admin, {
      episodeId: episode.id,
      agreedPrice: 30000,
      buyer: { displayName: "ZZTest Future Buyer", email: "ZZ-Future@example.com", state: "CA" },
    });
    saleIds.push(sale.id);
    partyIds.push(sale.buyerPartyId);
    const lead = await db.party.findFirstOrThrow({ where: { email: "zz-future@example.com" } });
    partyIds.push(lead.id);

    const inst = await db.documentInstance.findUniqueOrThrow({ where: { id: result.instanceId! } });
    expect(inst.saleId).toBe(sale.id);
    expect(inst.status).toBe("SIGNED");

    // The intent to purchase has no automatic rule, so the row exists only if
    // the registry requires it; what matters is the linking is idempotent.
    expect(await adoptLibraryDocuments(sale.id, episode.id, { id: sale.buyerPartyId, email: "zz-future@example.com" })).toBe(0);
    const summary = await saleComplianceSummary(sale.id);
    expect(summary.rows.length).toBeGreaterThan(0);
  });
});
