/**
 * Phase 4 finance services: expense ledger + profitability. Callers authorize
 * BEFORE calling. Profitability is ALWAYS computed from ledger entries; the
 * ProfitSnapshot preserves the numbers at financial close.
 */
import type { ExpenseEntry, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";

export class FinanceError extends Error {}

// Lifecycle: estimated → submitted → approved/declined → committed → incurred
// → paid → reimbursed; voided from any non-terminal state.
const EXPENSE_TRANSITIONS: Record<string, string[]> = {
  ESTIMATED: ["SUBMITTED", "COMMITTED", "INCURRED", "VOIDED"],
  SUBMITTED: ["APPROVED", "DECLINED", "VOIDED"],
  APPROVED: ["COMMITTED", "INCURRED", "VOIDED"],
  DECLINED: ["SUBMITTED", "VOIDED"],
  COMMITTED: ["INCURRED", "VOIDED"],
  INCURRED: ["PAID", "VOIDED"],
  PAID: ["REIMBURSED"],
  REIMBURSED: [],
  VOIDED: [],
};

export interface CreateExpenseInput {
  episodeId: string;
  categoryId: string;
  description: string;
  responsibility?: "DEALERSHIP" | "CONSIGNOR" | "BUYER_PASS_THROUGH" | "SHARED" | "REIMBURSABLE" | "PENDING";
  estimatedAmount?: number | null;
  actualAmount?: number | null;
  status?: keyof typeof EXPENSE_TRANSITIONS;
  workOrderId?: string | null;
  vendorPartyId?: string | null;
  notes?: string | null;
}

export async function createExpense(user: SessionUser, input: CreateExpenseInput) {
  const expense = await db.expenseEntry.create({
    data: {
      episodeId: input.episodeId,
      categoryId: input.categoryId,
      description: input.description,
      responsibility: input.responsibility ?? "DEALERSHIP",
      estimatedAmount: input.estimatedAmount ?? null,
      actualAmount: input.actualAmount ?? null,
      status: (input.status as never) ?? "ESTIMATED",
      workOrderId: input.workOrderId ?? null,
      vendorPartyId: input.vendorPartyId ?? null,
      notes: input.notes ?? null,
      createdById: user.id,
    },
  });
  await audit(user, {
    action: "expense.create",
    resourceType: "expense",
    resourceId: expense.id,
    newValues: { episodeId: input.episodeId, description: input.description, estimatedAmount: input.estimatedAmount },
  });
  return expense;
}

export async function setExpenseStatus(
  user: SessionUser,
  expenseId: string,
  status: keyof typeof EXPENSE_TRANSITIONS,
  amounts?: { approvedAmount?: number | null; committedAmount?: number | null; actualAmount?: number | null },
) {
  const expense = await db.expenseEntry.findUniqueOrThrow({ where: { id: expenseId } });
  const allowed = EXPENSE_TRANSITIONS[expense.status] ?? [];
  if (!allowed.includes(status)) {
    throw new FinanceError(`Cannot move expense from ${expense.status} to ${status}`);
  }
  const updated = await db.expenseEntry.update({
    where: { id: expenseId },
    data: {
      status: status as never,
      approvedAmount: amounts?.approvedAmount ?? undefined,
      committedAmount: amounts?.committedAmount ?? undefined,
      actualAmount: amounts?.actualAmount ?? undefined,
      paidAt: status === "PAID" ? new Date() : undefined,
      voidedAt: status === "VOIDED" ? new Date() : undefined,
    },
  });
  await audit(user, {
    action: "expense.status",
    resourceType: "expense",
    resourceId: expenseId,
    previousValues: { status: expense.status },
    newValues: { status, ...amounts },
  });
  return updated;
}

/** Called when a work order completes — records the incurred cost in the ledger. */
export async function ensureExpenseForWorkOrder(user: SessionUser, workOrderId: string) {
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  if (wo.status !== "COMPLETE") return null;
  const existing = await db.expenseEntry.findFirst({ where: { workOrderId } });
  const amount = wo.actualCost ?? wo.estimatedCost;
  if (existing) {
    if (existing.status === "ESTIMATED" || existing.status === "APPROVED" || existing.status === "COMMITTED") {
      return setExpenseStatus(user, existing.id, "INCURRED", { actualAmount: amount ? Number(amount) : undefined });
    }
    return existing;
  }
  let categoryKey = "misc";
  if (wo.departmentId) {
    const dept = await db.department.findUnique({ where: { id: wo.departmentId } });
    if (dept && ["mechanical", "detailing", "body"].includes(dept.key)) categoryKey = dept.key;
  }
  const category =
    (await db.expenseCategory.findUnique({ where: { key: categoryKey } })) ??
    (await db.expenseCategory.findFirstOrThrow());
  return createExpense(user, {
    episodeId: wo.episodeId,
    categoryId: category.id,
    description: `Work order: ${wo.title}`,
    estimatedAmount: wo.estimatedCost ? Number(wo.estimatedCost) : null,
    actualAmount: amount ? Number(amount) : null,
    status: "INCURRED",
    workOrderId: wo.id,
    vendorPartyId: wo.vendorPartyId,
  });
}

// ---------------------------------------------------------------------------
// Profitability (computed, never stored — except the close snapshot)
// ---------------------------------------------------------------------------

/** Best-known amount for an entry: actual > committed > approved > estimated. */
export function effectiveAmount(e: Pick<ExpenseEntry, "actualAmount" | "committedAmount" | "approvedAmount" | "estimatedAmount">): number {
  const v = e.actualAmount ?? e.committedAmount ?? e.approvedAmount ?? e.estimatedAmount;
  return v ? Number(v) : 0;
}

export interface Profitability {
  episodeId: string;
  revenue: number | null; // sale price when sold; asking price as projection
  revenueIsProjected: boolean;
  acquisitionCost: number | null;
  dealershipExpenses: number;
  consignorExpenses: number;
  otherExpenses: number;
  dealershipRevenue: number | null; // consignment: commission share
  grossProfit: number | null;
  netProfit: number | null;
  entries: { id: string; description: string; responsibility: string; status: string; amount: number }[];
}

export async function computeProfitability(episodeId: string): Promise<Profitability> {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { arrangement: true },
  });
  const expenses = await db.expenseEntry.findMany({
    where: { episodeId, status: { notIn: ["VOIDED", "DECLINED"] } },
  });

  let dealership = 0;
  let consignor = 0;
  let other = 0;
  const entries = expenses.map((e) => {
    const amount = effectiveAmount(e);
    if (e.responsibility === "DEALERSHIP" || e.responsibility === "SHARED") dealership += amount;
    else if (e.responsibility === "CONSIGNOR") consignor += amount;
    else other += amount;
    return { id: e.id, description: e.description, responsibility: e.responsibility, status: e.status, amount };
  });

  // A real deal price beats the asking-price projection.
  const activeSale = await db.saleTransaction.findFirst({
    where: { episodeId, status: { notIn: ["CANCELED", "UNWOUND"] } },
    orderBy: { createdAt: "desc" },
  });
  const revenue = activeSale ? Number(activeSale.agreedPrice) : episode.askingPrice ? Number(episode.askingPrice) : null;
  const arr = episode.arrangement;
  const acquisitionCost = arr?.purchasePrice ? Number(arr.purchasePrice) : null;

  // Dealership share of revenue.
  let dealershipRevenue: number | null = revenue;
  if (episode.dealType === "CONSIGNMENT" && revenue != null && arr) {
    if (arr.guaranteedConsignorNet != null) {
      dealershipRevenue = revenue - Number(arr.guaranteedConsignorNet);
    } else if (arr.commissionStructure && typeof arr.commissionStructure === "object") {
      const cs = arr.commissionStructure as { type?: string; value?: number; minimum?: number };
      if (cs.type === "percent" && cs.value != null) {
        dealershipRevenue = Math.max((revenue * cs.value) / 100, cs.minimum ?? 0);
      } else if (cs.type === "flat" && cs.value != null) {
        dealershipRevenue = cs.value;
      } else {
        dealershipRevenue = null;
      }
    } else {
      dealershipRevenue = null;
    }
  }

  const grossProfit =
    dealershipRevenue != null ? dealershipRevenue - (episode.dealType === "CONSIGNMENT" ? 0 : acquisitionCost ?? 0) : null;
  const netProfit = grossProfit != null ? grossProfit - dealership : null;

  return {
    episodeId,
    revenue,
    revenueIsProjected:
      !(activeSale && ["DELIVERED", "COMPLETE"].includes(activeSale.status)) &&
      episode.financialCloseStatus !== "FINANCIALLY_CLOSED",
    acquisitionCost,
    dealershipExpenses: dealership,
    consignorExpenses: consignor,
    otherExpenses: other,
    dealershipRevenue,
    grossProfit,
    netProfit,
    entries,
  };
}

/** Immutable snapshot at financial close. Refuses to overwrite an existing one. */
export async function snapshotProfit(user: SessionUser, episodeId: string) {
  const existing = await db.profitSnapshot.findUnique({ where: { episodeId } });
  if (existing) throw new FinanceError("A profit snapshot already exists for this episode");
  const p = await computeProfitability(episodeId);
  const snapshot = await db.profitSnapshot.create({
    data: {
      episodeId,
      revenue: p.revenue,
      acquisitionCost: p.acquisitionCost,
      dealershipExpenses: p.dealershipExpenses,
      consignorExpenses: p.consignorExpenses,
      otherExpenses: p.otherExpenses,
      grossProfit: p.grossProfit,
      netProfit: p.netProfit,
      detail: JSON.parse(JSON.stringify(p.entries)) as Prisma.InputJsonValue,
      computedById: user.id,
    },
  });
  await audit(user, { action: "profit.snapshot", resourceType: "episode", resourceId: episodeId, newValues: { netProfit: p.netProfit } });
  return snapshot;
}
