/**
 * Intake documents on the vehicle page — printing the consignment agreement
 * and recording that the signed copy is on file, before any sale exists.
 *
 * The behaviors that matter: the app serves the dealership's approved copy
 * once one is loaded (and the labelled DEMO stand-in until then); "on file"
 * can never be claimed about nothing; the vehicle page's paperwork blocker
 * clears when the signed copy is filed; and a deal opened later adopts the
 * intake-filed agreement instead of asking for it again.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import {
  DocumentError,
  markIntakeDocumentOnFile,
  produceIntakeDocument,
} from "@/modules/documents/service";
import { uploadApprovedTemplate } from "@/modules/documents/templates";
import { intakeReadiness } from "@/modules/documents/intake";
import { evaluateSaleRequirements } from "@/modules/documents/requirements";

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
    id: base.id,
    sessionId: "test",
    name: base.name,
    email: base.email,
    roleKeys: [roleKey],
    isOwner: roleKey === "admin",
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
}

// A tiny but structurally valid PDF, standing in for the dealership's
// counsel-approved consignment agreement.
const APPROVED_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\nZZTEST-APPROVED-CONSIGNMENT-AGREEMENT",
);

let admin: SessionUser;
let episodeId: string;
let vehicleId: string;
let templateId: string;
let priorApprovedFileId: string | null = null;
let buyerPartyId: string | null = null;
let saleId: string | null = null;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  admin = sessionUserFor("admin", jade);

  const template = await db.documentTemplate.findUniqueOrThrow({ where: { key: "consignment_agreement" } });
  templateId = template.id;
  // The dev database may already hold an approved copy — put it back afterwards.
  priorApprovedFileId = template.approvedFileId;
  await db.documentTemplate.update({ where: { id: templateId }, data: { approvedFileId: null } });

  const vehicle = await db.vehicle.create({
    data: { make: "ZZTestIntake", model: "Consign", year: 1961, mileageStatus: "EXEMPT" },
  });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: { vehicleId, stockNumber: `ZZID-${Date.now()}`, dealType: "CONSIGNMENT" },
  });
  episodeId = episode.id;
});

afterAll(async () => {
  if (saleId) {
    await db.saleDocumentRequirement.deleteMany({ where: { saleId } });
    await db.documentInstance.deleteMany({ where: { saleId } });
    await db.saleTransaction.delete({ where: { id: saleId } }).catch(() => {});
  }
  if (buyerPartyId) await db.party.delete({ where: { id: buyerPartyId } }).catch(() => {});
  await db.documentInstance.deleteMany({ where: { episodeId } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } }).catch(() => {});
  await db.vehicle.delete({ where: { id: vehicleId } }).catch(() => {});
  await db.documentTemplate.update({ where: { id: templateId }, data: { approvedFileId: priorApprovedFileId } });
});

describe("producing the consignment agreement at intake", () => {
  it("falls back to the DEMO stand-in while no approved copy is loaded", async () => {
    const { instance, approved } = await produceIntakeDocument(admin, episodeId, "consignment_agreement");
    expect(approved).toBe(false);
    expect(instance.saleId).toBeNull();
    expect(instance.version).toBe(1);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: instance.fileId } });
    expect(file.contentType).toBe("application/pdf");
    expect(file.sensitivity).toBeNull(); // a blank carries no customer data
  });

  it("serves the dealership's own approved copy once it is loaded", async () => {
    await uploadApprovedTemplate(admin, {
      templateKey: "consignment_agreement",
      originalName: "ConsignmentAgreement.pdf",
      contentType: "application/pdf",
      data: APPROVED_PDF,
    });

    const { instance, approved } = await produceIntakeDocument(admin, episodeId, "consignment_agreement");
    expect(approved).toBe(true);
    expect(instance.version).toBe(2); // versions continue; the demo copy is superseded
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: instance.fileId } });
    expect(file.sizeBytes).toBe(APPROVED_PDF.length); // byte-for-byte the approved copy

    const demo = await db.documentInstance.findFirst({
      where: { episodeId, saleId: null, templateId, version: 1 },
    });
    expect(demo?.status).toBe("VOIDED");
  });

  it("refuses documents that are not printable blanks", async () => {
    // original_title is a category-3 controlled original.
    await expect(produceIntakeDocument(admin, episodeId, "original_title")).rejects.toThrow(DocumentError);
  });
});

describe("marking the signed copy on file", () => {
  it("cannot be claimed about nothing", async () => {
    const bare = await db.inventoryEpisode.create({
      data: { vehicleId, stockNumber: `ZZID2-${Date.now()}`, dealType: "CONSIGNMENT" },
    });
    await expect(markIntakeDocumentOnFile(admin, bare.id, "consignment_agreement")).rejects.toThrow(
      DocumentError,
    );
    await db.inventoryEpisode.delete({ where: { id: bare.id } });
  });

  it("filing the printed copy clears the vehicle-page blocker", async () => {
    const before = await intakeReadiness(episodeId);
    const beforeItem = before.items.find((i) => i.key === "consignment_agreement")!;
    expect(beforeItem.state).toBe("REQUIRED");
    expect(beforeItem.onFile).toBe(false);
    expect(before.blockers.some((b) => b.key === "consignment_agreement")).toBe(true);

    const filed = await markIntakeDocumentOnFile(admin, episodeId, "consignment_agreement");
    expect(filed.status).toBe("FILED");
    expect(filed.signedAt).not.toBeNull();

    const after = await intakeReadiness(episodeId);
    const afterItem = after.items.find((i) => i.key === "consignment_agreement")!;
    expect(afterItem.onFile).toBe(true);
    expect(after.blockers.some((b) => b.key === "consignment_agreement")).toBe(false);
  });

  it("a scan of the signed copy is stored as a protected document", async () => {
    const scan = await markIntakeDocumentOnFile(admin, episodeId, "consignment_agreement", {
      originalName: "signed-agreement.pdf",
      contentType: "application/pdf",
      data: Buffer.from("%PDF-1.4 ZZTEST signed scan %%EOF"),
    });
    expect(scan.status).toBe("FILED");
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: scan.fileId } });
    expect(file.sensitivity).toBe("signed_docs"); // the signed copy holds consignor details
  });

  it("rejects a scan that is not a PDF or photo", async () => {
    await expect(
      markIntakeDocumentOnFile(admin, episodeId, "consignment_agreement", {
        originalName: "notes.txt",
        contentType: "text/plain",
        data: Buffer.from("ZZTEST"),
      }),
    ).rejects.toThrow(DocumentError);
  });
});

describe("a deal opened later adopts the intake-filed agreement", () => {
  it("the sale checklist row arrives already complete, pointing at the filed copy", async () => {
    const buyer = await db.party.create({
      data: { kind: "PERSON", displayName: "ZZTest Buyer (intake docs)" },
    });
    buyerPartyId = buyer.id;
    const sale = await db.saleTransaction.create({
      data: {
        episodeId,
        buyerPartyId: buyer.id,
        agreedPrice: 25000,
        createdById: admin.id,
      },
    });
    saleId = sale.id;

    await evaluateSaleRequirements(admin, sale.id);

    const row = await db.saleDocumentRequirement.findFirstOrThrow({
      where: { saleId: sale.id, templateId },
    });
    expect(row.documentInstanceId).not.toBeNull();
    expect(row.consignorSigned).toBe(true);
    expect(row.dealerSigned).toBe(true);
    expect(row.filedAt).not.toBeNull();
    expect(row.complete).toBe(true);

    // The adopted instance is the intake-filed one (saleId stays null on it).
    const instance = await db.documentInstance.findUniqueOrThrow({ where: { id: row.documentInstanceId! } });
    expect(instance.saleId).toBeNull();
    expect(["SIGNED", "FILED"]).toContain(instance.status);
  });
});
