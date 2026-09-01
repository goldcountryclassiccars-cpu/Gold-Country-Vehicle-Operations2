/**
 * Integration tests for Phase 7: settlement computation + payout flow +
 * financial close (with auto profit snapshot), and transport transitions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import {
  approveSettlement,
  closeEpisodeFinancially,
  computeSettlement,
  createSettlement,
  markSettlementPaid,
  SettlementError,
} from "@/modules/settlements/service";
import { createTransportJob, setTransportStatus, TransportError } from "@/modules/transport/service";

function ownerUser(base: { id: string; name: string; email: string }): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === "owner")!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: "owner",
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  return {
    id: base.id, sessionId: "t", name: base.name, email: base.email, roleKeys: ["owner"],
    isOwner: true, previewRoleKey: null, departmentIds: [], departmentKeys: [],
    permissions, fieldGrants, defaultLandingPage: null,
  };
}

let owner: SessionUser;
let vehicleId: string;
let episodeId: string;
let saleId: string;
let buyerId: string;
let consignorId: string;
let categoryId: string;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  owner = ownerUser(jade);
  categoryId = (await db.expenseCategory.findFirstOrThrow()).id;

  const consignor = await db.party.create({ data: { kind: "PERSON", displayName: "Settle Consignor" } });
  consignorId = consignor.id;
  const buyer = await db.party.create({ data: { kind: "PERSON", displayName: "Settle Buyer" } });
  buyerId = buyer.id;

  const vehicle = await db.vehicle.create({ data: { make: "SettleTest", model: "X" } });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId,
      stockNumber: `SET-${Date.now()}`,
      dealType: "CONSIGNMENT",
      askingPrice: 30000,
      salesStatus: "DELIVERED",
      arrangement: {
        create: { sellerPartyId: consignorId, commissionStructure: { type: "percent", value: 10, minimum: 2000 } },
      },
    },
  });
  episodeId = episode.id;
  const sale = await db.saleTransaction.create({
    data: {
      episodeId, buyerPartyId: buyerId, createdById: jade.id, status: "DELIVERED",
      agreedPrice: 28000, deliveredAt: new Date(),
    },
  });
  saleId = sale.id;
  await db.expenseEntry.create({
    data: {
      episodeId, categoryId, description: "Consignor-approved brake work", responsibility: "CONSIGNOR",
      status: "PAID", actualAmount: 500, createdById: jade.id,
    },
  });
});

afterAll(async () => {
  await db.expenseEntry.deleteMany({ where: { episodeId } });
  await db.settlement.deleteMany({ where: { episodeId } });
  await db.profitSnapshot.deleteMany({ where: { episodeId } });
  await db.transportJob.deleteMany({ where: { episodeId } });
  await db.saleTransaction.delete({ where: { id: saleId } });
  await db.arrangement.deleteMany({ where: { episodeId } });
  await db.statusChange.deleteMany({ where: { episodeId } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } });
  await db.vehicle.delete({ where: { id: vehicleId } });
  await db.party.deleteMany({ where: { id: { in: [buyerId, consignorId] } } });
  await db.$disconnect();
});

describe("settlement computation", () => {
  it("computes commission (percent w/ minimum) and consignor chargebacks", async () => {
    const c = await computeSettlement(episodeId);
    expect(c.salePrice).toBe(28000);
    expect(c.commissionAmount).toBe(2800); // 10% > $2000 minimum
    expect(c.expenseChargebacks).toBe(500);
    expect(c.netToConsignor).toBe(24700);
  });
});

describe("settlement flow → financial close", () => {
  it("generates, approves, pays; each step advances financial status", async () => {
    const s = await createSettlement(owner, episodeId);
    expect(Number(s.netToConsignor)).toBe(24700);
    expect(s.dueBy).not.toBeNull();
    let ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep.financialCloseStatus).toBe("CONSIGNOR_PAYABLE");

    await expect(createSettlement(owner, episodeId)).rejects.toThrow(SettlementError);
    await expect(markSettlementPaid(owner, s.id)).rejects.toThrow(SettlementError); // not approved yet

    await approveSettlement(owner, s.id);
    await markSettlementPaid(owner, s.id, "ACH-123");
    ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep.financialCloseStatus).toBe("PAYOUT_COMPLETE");
  });

  it("financial close snapshots profit and deactivates the episode", async () => {
    await closeEpisodeFinancially(owner, episodeId);
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep.financialCloseStatus).toBe("FINANCIALLY_CLOSED");
    expect(ep.active).toBe(false);
    const snap = await db.profitSnapshot.findUnique({ where: { episodeId } });
    expect(snap).not.toBeNull();
    // Consignment: dealer share 2800 commission; no dealership expenses here.
    expect(Number(snap!.netProfit)).toBe(2800);
  });
});

describe("transport", () => {
  it("walks quote → delivered, guards invalid transitions, posts the cost", async () => {
    const job = await createTransportJob(owner, {
      episodeId, direction: "INBOUND", quoteAmount: 350, pickupLocation: "Auburn, CA",
    });
    expect(job.status).toBe("QUOTED");
    await expect(setTransportStatus(owner, job.id, "DELIVERED")).rejects.toThrow(TransportError);
    await setTransportStatus(owner, job.id, "BOOKED");
    await setTransportStatus(owner, job.id, "PICKUP_SCHEDULED");
    await setTransportStatus(owner, job.id, "IN_TRANSIT");
    const done = await setTransportStatus(owner, job.id, "DELIVERED", { actualCost: 340 });
    expect(done.status).toBe("DELIVERED");
    const expense = await db.expenseEntry.findFirst({
      where: { episodeId, description: "Inbound transport" },
    });
    expect(expense).not.toBeNull();
    expect(Number(expense!.actualAmount)).toBe(340);
  });
});
