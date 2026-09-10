/**
 * Loading the dealership's own approved documents, and the setup checklist
 * that tells them what is still missing.
 *
 * The behaviour that matters: an approved file must actually replace the
 * DEMONSTRATION stand-in. A watermarked document handed to a buyer because the
 * upload silently did nothing is the failure this guards against.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { storage } from "@/lib/adapters/storage";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { AuthzError } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { clearApprovedTemplate, setSetupItem, TemplateError, uploadApprovedTemplate } from "@/modules/documents/templates";
import { documentSetupState } from "@/modules/documents/setup";
import { generateDocument } from "@/modules/documents/service";
import { createSale } from "@/modules/sales/service";
import { saleComplianceSummary, evaluateSaleRequirements } from "@/modules/documents/requirements";

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

/** A minimal but valid PDF, so nothing downstream is parsing invented bytes. */
const APPROVED_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

let admin: SessionUser;
let frontDesk: SessionUser;
const created = { vehicleIds: [] as string[], episodeIds: [] as string[], saleIds: [] as string[], partyIds: [] as string[] };
const TEMPLATE_KEY = "buyer_receipt";
let originalApprovedFileId: string | null = null;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const rose = await db.user.findUniqueOrThrow({ where: { email: "sales@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  frontDesk = sessionUserFor("front_desk", rose);
  const t = await db.documentTemplate.findUnique({ where: { key: TEMPLATE_KEY } });
  originalApprovedFileId = t?.approvedFileId ?? null;
});

afterAll(async () => {
  await db.documentTemplate.updateMany({
    where: { key: TEMPLATE_KEY },
    data: { approvedFileId: originalApprovedFileId, approvedAt: null, approvedById: null, approvedVersionNote: null },
  });
  await db.saleDocumentRequirement.deleteMany({ where: { saleId: { in: created.saleIds } } });
  await db.documentInstance.deleteMany({ where: { saleId: { in: created.saleIds } } });
  await db.saleTransaction.deleteMany({ where: { id: { in: created.saleIds } } });
  await db.statusChange.deleteMany({ where: { episodeId: { in: created.episodeIds } } });
  await db.inventoryEpisode.deleteMany({ where: { id: { in: created.episodeIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: created.vehicleIds } } });
  await db.party.deleteMany({ where: { id: { in: created.partyIds } } });
  await db.documentSetupItem.deleteMany({ where: { key: "compliance_review" } });
});

/** Reads back the audit trail's record of which path generation took. */
async function expectGeneratedAs(instanceId: string, approved: boolean) {
  const event = await db.auditEvent.findFirstOrThrow({
    where: { action: "document.generate", resourceId: instanceId },
    orderBy: { createdAt: "desc" },
  });
  expect((event.newValues as { approved?: boolean }).approved).toBe(approved);
}

async function makeSale() {
  const vehicle = await db.vehicle.create({
    data: { make: "ZZTestApproved", model: "T", year: 1969, mileageStatus: "ACTUAL" },
  });
  created.vehicleIds.push(vehicle.id);
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId: vehicle.id,
      stockNumber: `ZZTEST-A-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      dealType: "DEALER_PURCHASE",
      askingPrice: 25000,
    },
  });
  created.episodeIds.push(episode.id);
  const sale = await createSale(admin, {
    episodeId: episode.id,
    agreedPrice: 25000,
    buyer: { displayName: "ZZTest Approved Buyer", state: "CA" },
  });
  created.saleIds.push(sale.id);
  created.partyIds.push(sale.buyerPartyId);
  return sale;
}

describe("loading an approved template", () => {
  it("is Admin-only — the front desk cannot swap a legal document", async () => {
    await expect(
      uploadApprovedTemplate(frontDesk, {
        templateKey: TEMPLATE_KEY,
        originalName: "receipt.pdf",
        contentType: "application/pdf",
        data: APPROVED_PDF,
      }),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses anything that is not a PDF or Word document", async () => {
    await expect(
      uploadApprovedTemplate(admin, {
        templateKey: TEMPLATE_KEY,
        originalName: "notes.txt",
        contentType: "text/plain",
        data: Buffer.from("hello"),
      }),
    ).rejects.toThrow(TemplateError);
  });

  it("refuses an empty file", async () => {
    await expect(
      uploadApprovedTemplate(admin, {
        templateKey: TEMPLATE_KEY,
        originalName: "empty.pdf",
        contentType: "application/pdf",
        data: Buffer.alloc(0),
      }),
    ).rejects.toThrow(TemplateError);
  });

  it("refuses a controlled original — the DMV issues those, there is no blank", async () => {
    await expect(
      uploadApprovedTemplate(admin, {
        templateKey: "reg_51_report_of_sale",
        originalName: "reg51.pdf",
        contentType: "application/pdf",
        data: APPROVED_PDF,
      }),
    ).rejects.toThrow(/controlled original/i);
  });

  it("refuses a third-party document — those belong to one sale, not to a master list", async () => {
    await expect(
      uploadApprovedTemplate(admin, {
        templateKey: "smog_certificate",
        originalName: "smog.pdf",
        contentType: "application/pdf",
        data: APPROVED_PDF,
      }),
    ).rejects.toThrow(/per sale/i);
  });

  it("accepts the blank of a government form we print", async () => {
    const t = await uploadApprovedTemplate(admin, {
      templateKey: "reg_256_statement_of_facts",
      originalName: "reg256-blank.pdf",
      contentType: "application/pdf",
      data: APPROVED_PDF,
    });
    expect(t.approvedFileId).not.toBeNull();
    await clearApprovedTemplate(admin, "reg_256_statement_of_facts", "Test cleanup for the blank-form case");
  });

  it("records who loaded it and when", async () => {
    const before = await db.documentTemplate.findUniqueOrThrow({ where: { key: TEMPLATE_KEY } });
    expect(before.approvedFileId).toBeNull();

    await uploadApprovedTemplate(admin, {
      templateKey: TEMPLATE_KEY,
      originalName: "buyer-receipt-approved.pdf",
      contentType: "application/pdf",
      data: APPROVED_PDF,
      versionNote: "Counsel rev. 3/2026",
    });

    const after = await db.documentTemplate.findUniqueOrThrow({ where: { key: TEMPLATE_KEY } });
    expect(after.approvedFileId).not.toBeNull();
    expect(after.approvedById).toBe(admin.id);
    expect(after.approvedVersionNote).toBe("Counsel rev. 3/2026");
    expect(after.approvedAt).not.toBeNull();
  });
});

describe("generating with an approved template", () => {
  it("serves the approved file instead of a watermarked demo", async () => {
    const sale = await makeSale();
    const template = await db.documentTemplate.findUniqueOrThrow({ where: { key: TEMPLATE_KEY } });
    expect(template.approvedFileId).not.toBeNull(); // loaded by the test above

    const instance = await generateDocument(admin, sale.id, template.id);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: instance.fileId } });
    const bytes = await storage().get(file.storageKey);

    // The bytes are the approved document, not something this app drew.
    expect(bytes.equals(APPROVED_PDF)).toBe(true);
    await expectGeneratedAs(instance.id, true);
  });

  it("falls back to the watermarked demo when no approved copy is loaded", async () => {
    const sale = await makeSale();
    const template = await db.documentTemplate.findFirstOrThrow({
      where: { key: "purchase_agreement" },
    });
    expect(template.approvedFileId).toBeNull();

    const instance = await generateDocument(admin, sale.id, template.id);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: instance.fileId } });
    const bytes = await storage().get(file.storageKey);

    // pdf-lib compresses its text streams, so the watermark is not greppable in
    // the raw bytes — asserting on the string would pass for the wrong reason.
    // The decision itself is what matters, and it is audited.
    expect(bytes.equals(APPROVED_PDF)).toBe(false);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await expectGeneratedAs(instance.id, false);
  });

  it("links what it produced back to the checklist row, so the row can open it", async () => {
    const sale = await makeSale();
    await evaluateSaleRequirements(admin, sale.id);
    const template = await db.documentTemplate.findUniqueOrThrow({ where: { key: TEMPLATE_KEY } });

    const before = await saleComplianceSummary(sale.id);
    expect(before.rows.find((r) => r.key === TEMPLATE_KEY)!.documentFileId).toBeNull();

    const instance = await generateDocument(admin, sale.id, template.id);

    const after = await saleComplianceSummary(sale.id);
    const row = after.rows.find((r) => r.key === TEMPLATE_KEY)!;
    expect(row.documentFileId).toBe(instance.fileId);
    expect(row.approvedTemplate).toBe(true);
  });

  it("reverts to the demo when the approved copy is removed", async () => {
    await clearApprovedTemplate(admin, TEMPLATE_KEY, "Superseded by the 2027 revision");
    const template = await db.documentTemplate.findUniqueOrThrow({ where: { key: TEMPLATE_KEY } });
    expect(template.approvedFileId).toBeNull();

    const sale = await makeSale();
    const instance = await generateDocument(admin, sale.id, template.id);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: instance.fileId } });
    const bytes = await storage().get(file.storageKey);
    expect(bytes.equals(APPROVED_PDF)).toBe(false);
    await expectGeneratedAs(instance.id, false);
  });

  it("demands a reason before removing an approved document", async () => {
    await expect(clearApprovedTemplate(admin, TEMPLATE_KEY, "no")).rejects.toThrow(TemplateError);
  });
});

describe("the setup checklist", () => {
  it("mirrors the twelve items from SALES_DOCUMENT_SETUP.md", async () => {
    const state = await documentSetupState();
    expect(state.total).toBe(12);
    expect(state.items.map((i) => i.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(state.items.every((i) => i.need.length > 0 && i.detail.length > 0)).toBe(true);
  });

  it("counts only the documents that can hold a blank master, so the item can finish", async () => {
    const state = await documentSetupState();
    // Categories 3 and 4 can never have one, so counting them in the
    // denominator would leave this item permanently short of done.
    const loadable = await db.documentTemplate.count({ where: { active: true, category: { in: [1, 2] } } });
    const approved = await db.documentTemplate.count({
      where: { active: true, category: { in: [1, 2] }, approvedFileId: { not: null } },
    });
    const allActive = await db.documentTemplate.count({ where: { active: true } });
    expect(loadable).toBeLessThan(allActive);
    expect(state.templatesTotal).toBe(loadable);
    expect(state.templatesApproved).toBe(approved);

    const rules = state.items.find((i) => i.key === "applicability_rules")!;
    expect(rules.answerable).toBe(false); // cannot be ticked by hand
  });

  it("lets an admin record an answer to a judgment item, and shows it back", async () => {
    await setSetupItem(admin, "compliance_review", true, "Reviewed with counsel 2026-10-02, no changes.");
    const state = await documentSetupState();
    const item = state.items.find((i) => i.key === "compliance_review")!;
    expect(item.status).toBe("done");
    expect(item.detail).toContain("Reviewed with counsel");
    expect(item.providedAt).not.toBeNull();
  });

  it("does not let the front desk answer setup items", async () => {
    await expect(setSetupItem(frontDesk, "esign_vendor", true, "whatever")).rejects.toThrow(AuthzError);
  });

  it("counts a partly-loaded template set as part done rather than done", async () => {
    await uploadApprovedTemplate(admin, {
      templateKey: TEMPLATE_KEY,
      originalName: "receipt.pdf",
      contentType: "application/pdf",
      data: APPROVED_PDF,
    });
    const state = await documentSetupState();
    const templatesItem = state.items.find((i) => i.key === "approved_templates")!;
    expect(templatesItem.status).toBe("partial");
    expect(templatesItem.detail).toContain("still generate a watermark");
  });
});
