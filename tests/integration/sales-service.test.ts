/**
 * Integration tests for Phase 6: the full deal lifecycle — deposit,
 * contract, funding via payments, document generation/sign, release gate
 * (normal + owner override), delivery, cancel-and-resell.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { AuthzError } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import {
  cancelSale,
  createSale,
  deliverVehicle,
  markContracted,
  recordPayment,
  releaseGate,
  releaseVehicle,
} from "@/modules/sales/service";
import { generateDocument, markDocumentSigned, sendDocument } from "@/modules/documents/service";

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

let owner: SessionUser;
let finance: SessionUser;
let vehicleId: string;
let episodeId: string;
const saleIds: string[] = [];
const partyIds: string[] = [];
const fileIds: string[] = [];

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const fiona = await db.user.findUniqueOrThrow({ where: { email: "finance@demo.gccc" } });
  owner = sessionUserFor("admin", jade);
  finance = sessionUserFor("front_desk", fiona);
  // mileageStatus is required before a deal can open — it is the odometer
  // disclosure, and a sale may not leave DRAFT while it is UNKNOWN.
  const vehicle = await db.vehicle.create({ data: { make: "SaleTest", model: "S", year: 1969, mileageStatus: "ACTUAL" } });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: { vehicleId, stockNumber: `ST-${Date.now()}`, dealType: "DEALER_PURCHASE", askingPrice: 20000 },
  });
  episodeId = episode.id;
});

afterAll(async () => {
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.documentInstance.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.fileObject.deleteMany({ where: { id: { in: fileIds } } });
  await db.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await db.party.deleteMany({ where: { id: { in: partyIds } } });
  await db.integrationEvent.deleteMany({ where: { episodeId } });
  await db.statusChange.deleteMany({ where: { episodeId } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } });
  await db.vehicle.delete({ where: { id: vehicleId } });
  await db.$disconnect();
});

describe("deal lifecycle", () => {
  let saleId: string;
  let docId: string;

  it("opens a deal (episode moves to DEPOSIT_REQUESTED)", async () => {
    const sale = await createSale(owner, {
      episodeId, agreedPrice: 19000, buyer: { displayName: "Test Buyer", email: "buyer@example.com" },
    });
    saleId = sale.id;
    saleIds.push(saleId);
    partyIds.push(sale.buyerPartyId);
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep.salesStatus).toBe("DEPOSIT_REQUESTED");
  });

  it("cleared deposit advances to DEPOSIT_RECEIVED; contract; full funding → FUNDED", async () => {
    await recordPayment(finance, { saleId, kind: "DEPOSIT", method: "WIRE", amount: 1000, status: "CLEARED" });
    let sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.status).toBe("DEPOSIT_RECEIVED");
    await markContracted(owner, saleId);
    await recordPayment(finance, { saleId, kind: "FINAL", method: "WIRE", amount: 18000, status: "CLEARED" });
    sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.status).toBe("FUNDED");
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep.salesStatus).toBe("FUNDED");
  });

  it("generates + signs a demonstration document (watermarked PDF)", async () => {
    const template = await db.documentTemplate.findFirstOrThrow({ where: { key: "purchase_agreement" } });
    const doc = await generateDocument(finance, saleId, template.id);
    docId = doc.id;
    fileIds.push(doc.fileId);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: doc.fileId } });
    expect(file.contentType).toBe("application/pdf");
    expect(file.sensitivity).toBe("signed_docs");
    await sendDocument(finance, docId);
    const signed = await markDocumentSigned(finance, docId);
    expect(signed.status).toBe("SIGNED");
  });

  it("release gate opens when funded + docs signed; releases and delivers", async () => {
    const gate = await releaseGate(saleId);
    expect(gate).toEqual({ funded: true, docsSigned: true, ok: true });
    await releaseVehicle(finance, saleId);
    await deliverVehicle(finance, saleId);
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep.salesStatus).toBe("DELIVERED");
    expect(ep.marketingStatus).toBe("MARKED_SOLD");
    const event = await db.integrationEvent.findFirst({ where: { episodeId, type: "vehicle.sold" } });
    expect(event).not.toBeNull();
  });
});

describe("release gate enforcement + cancel/resell", () => {
  it("blocks non-owner release when gate is closed; owner override works and is audited", async () => {
    // fresh vehicle for a second deal
    const v = await db.vehicle.create({ data: { make: "SaleTest2", model: "S2", mileageStatus: "ACTUAL" } });
    const ep = await db.inventoryEpisode.create({
      data: { vehicleId: v.id, stockNumber: `ST2-${Date.now()}`, dealType: "DEALER_PURCHASE", askingPrice: 9000 },
    });
    const sale = await createSale(owner, { episodeId: ep.id, agreedPrice: 9000, buyer: { displayName: "Second Buyer" } });
    saleIds.push(sale.id);
    partyIds.push(sale.buyerPartyId);
    await markContracted(owner, sale.id);

    await expect(releaseVehicle(finance, sale.id)).rejects.toThrow(AuthzError);
    await expect(releaseVehicle(owner, sale.id, "")).rejects.toThrow(AuthzError);
    await releaseVehicle(owner, sale.id, "Funds verified by phone with bank; wire clearing tomorrow");
    const audited = await db.auditEvent.findFirst({
      where: { action: "release.override", resourceId: sale.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audited).not.toBeNull();

    // cancel/resell on a third scenario: cancel returns the episode to AVAILABLE
    const sale2 = await db.saleTransaction.findUniqueOrThrow({ where: { id: sale.id } });
    expect(sale2.status).toBe("RELEASED");

    await db.statusChange.deleteMany({ where: { episodeId: ep.id } });
    await db.payment.deleteMany({ where: { saleId: sale.id } });
    await db.saleTransaction.deleteMany({ where: { episodeId: ep.id } });
    // remove from cleanup list (already deleted here)
    saleIds.splice(saleIds.indexOf(sale.id), 1);
    await db.inventoryEpisode.delete({ where: { id: ep.id } });
    await db.vehicle.delete({ where: { id: v.id } });
  });

  it("canceling a deal returns the vehicle to AVAILABLE and keeps the record", async () => {
    const v = await db.vehicle.create({ data: { make: "SaleTest3", model: "S3", mileageStatus: "ACTUAL" } });
    const ep = await db.inventoryEpisode.create({
      data: { vehicleId: v.id, stockNumber: `ST3-${Date.now()}`, dealType: "CONSIGNMENT", askingPrice: 5000 },
    });
    const sale = await createSale(owner, { episodeId: ep.id, agreedPrice: 5000, buyer: { displayName: "Backout Buyer" } });
    await cancelSale(owner, sale.id, "Buyer financing fell through");
    const after = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: ep.id } });
    expect(after.salesStatus).toBe("AVAILABLE");
    const kept = await db.saleTransaction.findUniqueOrThrow({ where: { id: sale.id } });
    expect(kept.status).toBe("CANCELED");
    expect(kept.cancelReason).toContain("financing");

    await db.payment.deleteMany({ where: { saleId: sale.id } });
    await db.saleTransaction.delete({ where: { id: sale.id } });
    await db.party.delete({ where: { id: sale.buyerPartyId } });
    await db.statusChange.deleteMany({ where: { episodeId: ep.id } });
    await db.inventoryEpisode.delete({ where: { id: ep.id } });
    await db.vehicle.delete({ where: { id: v.id } });
  });
});
