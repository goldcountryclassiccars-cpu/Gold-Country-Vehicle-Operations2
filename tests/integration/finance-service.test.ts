/**
 * Integration tests for Phase 4 finance: expense lifecycle, profitability
 * computation (dealer-owned + consignment), and the close snapshot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import {
  computeProfitability,
  createExpense,
  effectiveAmount,
  FinanceError,
  setExpenseStatus,
  snapshotProfit,
} from "@/modules/finance/service";

let owner: SessionUser;
let vehicleId: string;
let ownedEpId: string;
let consignEpId: string;
let categoryId: string;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
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
  owner = {
    id: jade.id, sessionId: "t", name: jade.name, email: jade.email, roleKeys: ["owner"],
    isOwner: true, previewRoleKey: null, departmentIds: [], departmentKeys: [],
    permissions, fieldGrants, defaultLandingPage: null,
  };
  categoryId = (await db.expenseCategory.findFirstOrThrow()).id;
  const vehicle = await db.vehicle.create({ data: { make: "FinTest", model: "F" } });
  vehicleId = vehicle.id;
  const owned = await db.inventoryEpisode.create({
    data: {
      vehicleId, stockNumber: `FIN-O-${Date.now()}`, dealType: "DEALER_PURCHASE", askingPrice: 50000,
      arrangement: { create: { purchasePrice: 30000 } },
    },
  });
  ownedEpId = owned.id;
  const consign = await db.inventoryEpisode.create({
    data: {
      vehicleId, stockNumber: `FIN-C-${Date.now()}`, dealType: "CONSIGNMENT", askingPrice: 40000,
      arrangement: { create: { guaranteedConsignorNet: 34000 } },
    },
  });
  consignEpId = consign.id;
});

afterAll(async () => {
  await db.expenseEntry.deleteMany({ where: { episodeId: { in: [ownedEpId, consignEpId] } } });
  await db.profitSnapshot.deleteMany({ where: { episodeId: { in: [ownedEpId, consignEpId] } } });
  await db.arrangement.deleteMany({ where: { episodeId: { in: [ownedEpId, consignEpId] } } });
  await db.statusChange.deleteMany({ where: { episodeId: { in: [ownedEpId, consignEpId] } } });
  await db.inventoryEpisode.deleteMany({ where: { id: { in: [ownedEpId, consignEpId] } } });
  await db.vehicle.delete({ where: { id: vehicleId } });
  await db.$disconnect();
});

describe("expense lifecycle", () => {
  it("walks estimated → submitted → approved → committed → incurred → paid", async () => {
    const e = await createExpense(owner, {
      episodeId: ownedEpId, categoryId, description: "Transport", estimatedAmount: 500,
    });
    expect(e.status).toBe("ESTIMATED");
    await setExpenseStatus(owner, e.id, "SUBMITTED");
    await setExpenseStatus(owner, e.id, "APPROVED", { approvedAmount: 500 });
    await setExpenseStatus(owner, e.id, "COMMITTED", { committedAmount: 500 });
    await setExpenseStatus(owner, e.id, "INCURRED", { actualAmount: 480 });
    const paid = await setExpenseStatus(owner, e.id, "PAID");
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();
    expect(effectiveAmount(paid)).toBe(480);
  });

  it("rejects invalid transitions", async () => {
    const e = await createExpense(owner, { episodeId: ownedEpId, categoryId, description: "X", estimatedAmount: 10 });
    await expect(setExpenseStatus(owner, e.id, "PAID")).rejects.toThrow(FinanceError);
    await setExpenseStatus(owner, e.id, "VOIDED");
    await expect(setExpenseStatus(owner, e.id, "SUBMITTED")).rejects.toThrow(FinanceError);
  });
});

describe("profitability", () => {
  it("dealer-owned: revenue - acquisition - dealership expenses; excludes voided", async () => {
    const p = await computeProfitability(ownedEpId);
    // paid 480 transport counts; voided 10 does not
    expect(p.acquisitionCost).toBe(30000);
    expect(p.revenue).toBe(50000);
    expect(p.dealershipExpenses).toBe(480);
    expect(p.grossProfit).toBe(20000);
    expect(p.netProfit).toBe(19520);
  });

  it("consignment: dealer share = revenue - guaranteed net; acquisition not subtracted", async () => {
    await createExpense(owner, {
      episodeId: consignEpId, categoryId, description: "Detail", estimatedAmount: 200, responsibility: "DEALERSHIP",
    });
    await createExpense(owner, {
      episodeId: consignEpId, categoryId, description: "Consignor-paid brakes", estimatedAmount: 400, responsibility: "CONSIGNOR",
    });
    const p = await computeProfitability(consignEpId);
    expect(p.dealershipRevenue).toBe(6000); // 40000 - 34000
    expect(p.dealershipExpenses).toBe(200);
    expect(p.consignorExpenses).toBe(400);
    expect(p.netProfit).toBe(5800);
  });

  it("snapshot preserves numbers and refuses duplicates", async () => {
    const snap = await snapshotProfit(owner, ownedEpId);
    expect(Number(snap.netProfit)).toBe(19520);
    await expect(snapshotProfit(owner, ownedEpId)).rejects.toThrow(FinanceError);
  });
});
