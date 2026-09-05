/**
 * Phase 7 consignor settlements. The statement is computed from the sale,
 * the confidential arrangement, and consignor-responsibility ledger entries.
 * Payout requires approval; paying advances financial close; financial close
 * captures the immutable profit snapshot.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";
import { changeEpisodeStatus } from "@/modules/episodes/service";
import { effectiveAmount, snapshotProfit, FinanceError } from "@/modules/finance/service";

export class SettlementError extends Error {}

/**
 * When the buyer's money actually cleared — the anchor for the consignor payout
 * deadline, and half of the gate below.
 *
 * Deliberately the LAST cleared payment, not the first: the clock on paying a
 * consignor starts when the dealership holds all the funds, not when a deposit
 * landed.
 */
export function fundsClearedAt(payments: { status: string; kind: string; clearedAt: Date | null }[]): Date | null {
  const cleared = payments
    .filter((p) => p.status === "CLEARED" && p.kind !== "REFUND" && p.clearedAt)
    .map((p) => p.clearedAt!.getTime());
  return cleared.length ? new Date(Math.max(...cleared)) : null;
}

export interface ConsignorPayoutClock {
  fundsClearedAt: Date | null;
  cancellationWindowEndsAt: Date | null;
  /** Funds cleared + the configured payout days. Null until funds clear. */
  dueBy: Date | null;
  daysRemaining: number | null;
  overdue: boolean;
  /** Why a payout cannot be raised yet, or null when it can. */
  blockedBy: string | null;
}

export async function consignorPayoutDays(): Promise<number> {
  const setting = await db.appSetting.findUnique({ where: { key: "settlement_deadline_days" } });
  return typeof setting?.value === "number" ? setting.value : 14;
}

/**
 * The countdown shown on the vehicle page and in Deals in Progress.
 *
 * Two independent things hold a payout: the money has to have cleared, and any
 * cancellation window has to have closed. Paying a consignor inside the CARS
 * Act window means the dealership has given away money for a car the buyer can
 * still hand back.
 */
export async function consignorPayoutClock(episodeId: string, now = new Date()): Promise<ConsignorPayoutClock> {
  const sale = await db.saleTransaction.findFirst({
    where: { episodeId, status: { notIn: ["CANCELED", "UNWOUND"] } },
    orderBy: { createdAt: "desc" },
    include: { payments: true },
  });
  const empty: ConsignorPayoutClock = {
    fundsClearedAt: null,
    cancellationWindowEndsAt: null,
    dueBy: null,
    daysRemaining: null,
    overdue: false,
    blockedBy: "No active deal",
  };
  if (!sale) return empty;

  const cleared = fundsClearedAt(sale.payments);
  const fullyFunded =
    sale.payments
      .filter((p) => p.status === "CLEARED" && p.kind !== "REFUND")
      .reduce((sum, p) => sum + Number(p.amount), 0) >= Number(sale.agreedPrice);
  const window = sale.cancellationWindowEndsAt;

  const blockedBy = !cleared || !fullyFunded
    ? "Buyer funds have not cleared"
    : window && window > now
      ? `Cancellation window closes ${window.toLocaleDateString()}`
      : null;

  if (!cleared || !fullyFunded) {
    return { ...empty, cancellationWindowEndsAt: window, blockedBy };
  }

  const days = await consignorPayoutDays();
  const dueBy = new Date(cleared.getTime() + days * 86400_000);
  const daysRemaining = Math.ceil((dueBy.getTime() - now.getTime()) / 86400_000);
  return {
    fundsClearedAt: cleared,
    cancellationWindowEndsAt: window,
    dueBy,
    daysRemaining,
    overdue: daysRemaining < 0,
    blockedBy,
  };
}

export interface SettlementComputation {
  salePrice: number;
  commissionAmount: number;
  expenseChargebacks: number;
  netToConsignor: number;
  lines: { label: string; amount: number }[];
}

export async function computeSettlement(episodeId: string): Promise<SettlementComputation> {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { arrangement: true },
  });
  if (episode.dealType !== "CONSIGNMENT") throw new SettlementError("Settlements apply to consignment episodes");
  const sale = await db.saleTransaction.findFirst({
    where: { episodeId, status: { in: ["DELIVERED", "COMPLETE", "RELEASED", "FUNDED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sale) throw new SettlementError("No funded/delivered sale to settle");
  const arr = episode.arrangement;
  const salePrice = Number(sale.agreedPrice);

  let commission = 0;
  if (arr?.guaranteedConsignorNet != null) {
    commission = salePrice - Number(arr.guaranteedConsignorNet);
  } else if (arr?.commissionStructure && typeof arr.commissionStructure === "object") {
    const cs = arr.commissionStructure as { type?: string; value?: number; minimum?: number };
    if (cs.type === "percent" && cs.value != null) commission = Math.max((salePrice * cs.value) / 100, cs.minimum ?? 0);
    else if (cs.type === "flat" && cs.value != null) commission = cs.value;
  }

  const chargebackEntries = await db.expenseEntry.findMany({
    where: { episodeId, responsibility: "CONSIGNOR", status: { notIn: ["VOIDED", "DECLINED"] } },
  });
  const chargebacks = chargebackEntries.reduce((s, e) => s + effectiveAmount(e), 0);

  const lines = [
    { label: "Sale price", amount: salePrice },
    { label: "Dealership commission", amount: -commission },
    ...chargebackEntries.map((e) => ({ label: `Chargeback: ${e.description}`, amount: -effectiveAmount(e) })),
  ];
  return {
    salePrice,
    commissionAmount: commission,
    expenseChargebacks: chargebacks,
    netToConsignor: salePrice - commission - chargebacks,
    lines,
  };
}

export async function createSettlement(user: SessionUser, episodeId: string) {
  const existing = await db.settlement.findUnique({ where: { episodeId } });
  if (existing) throw new SettlementError("A settlement already exists for this episode");
  const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId }, include: { arrangement: true } });
  if (!episode.arrangement?.sellerPartyId) throw new SettlementError("No consignor party on the arrangement");

  // Both gates first, before any lookup that can fail obscurely. The funded-sale
  // query below used to run first, so an unfunded deal produced a raw Prisma
  // "no record was found" instead of telling the employee the money has not
  // cleared yet.
  const clock = await consignorPayoutClock(episodeId);
  if (clock.blockedBy) throw new SettlementError(`Cannot raise a consignor settlement yet — ${clock.blockedBy}.`);

  const sale = await db.saleTransaction.findFirstOrThrow({
    where: { episodeId, status: { in: ["DELIVERED", "COMPLETE", "RELEASED", "FUNDED"] } },
    orderBy: { createdAt: "desc" },
  });

  const c = await computeSettlement(episodeId);

  // The deadline runs from when the funds cleared, not from delivery: a car can
  // sit undelivered for weeks after it is paid for, and the consignor's clock
  // does not wait for the transporter.
  const anchor = clock.fundsClearedAt ?? sale.deliveredAt ?? new Date();
  const days = await consignorPayoutDays();

  const settlement = await db.settlement.create({
    data: {
      episodeId,
      saleId: sale.id,
      consignorPartyId: episode.arrangement.sellerPartyId,
      status: "PENDING_APPROVAL",
      salePrice: c.salePrice,
      commissionAmount: c.commissionAmount,
      expenseChargebacks: c.expenseChargebacks,
      netToConsignor: c.netToConsignor,
      dueBy: clock.dueBy ?? new Date(anchor.getTime() + days * 86400_000),
      detail: JSON.parse(JSON.stringify(c.lines)),
      createdById: user.id,
    },
  });
  await changeEpisodeStatus(user, episodeId, "financial", "CONSIGNOR_PAYABLE", "Settlement generated");
  await audit(user, { action: "settlement.create", resourceType: "settlement", resourceId: settlement.id, newValues: { netToConsignor: c.netToConsignor } });
  const { notifyUsers, userIdsWithRole } = await import("@/modules/notifications/service");
  await notifyUsers(await userIdsWithRole("owner"), {
    title: "Consignor settlement awaiting approval",
    body: `Stock ${episode.stockNumber}`,
    href: "/settlements",
  }).catch(() => {});
  return settlement;
}

export async function approveSettlement(user: SessionUser, settlementId: string) {
  const s = await db.settlement.findUniqueOrThrow({ where: { id: settlementId } });
  if (s.status !== "PENDING_APPROVAL") throw new SettlementError("Settlement is not awaiting approval");
  const updated = await db.settlement.update({
    where: { id: settlementId },
    data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
  });
  await changeEpisodeStatus(user, s.episodeId, "financial", "PAYOUT_APPROVAL_PENDING", "Settlement approved; payout pending");
  await audit(user, { action: "settlement.approve", resourceType: "settlement", resourceId: settlementId });
  return updated;
}

export async function markSettlementPaid(user: SessionUser, settlementId: string, reference?: string) {
  const s = await db.settlement.findUniqueOrThrow({ where: { id: settlementId } });
  if (s.status !== "APPROVED") throw new SettlementError("Settlement must be approved before payment");
  const updated = await db.settlement.update({
    where: { id: settlementId },
    data: { status: "PAID", paidAt: new Date(), reference: reference ?? null },
  });
  await changeEpisodeStatus(user, s.episodeId, "financial", "PAYOUT_COMPLETE", "Consignor paid");
  await audit(user, { action: "settlement.paid", resourceType: "settlement", resourceId: settlementId });
  return updated;
}

/** Final financial close: snapshot profit, close the episode. */
export async function closeEpisodeFinancially(user: SessionUser, episodeId: string) {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  if (episode.financialCloseStatus === "FINANCIALLY_CLOSED") throw new SettlementError("Episode already closed");
  if (episode.dealType === "CONSIGNMENT") {
    const settlement = await db.settlement.findUnique({ where: { episodeId } });
    if (!settlement || settlement.status !== "PAID") {
      throw new SettlementError("Consignment episodes close after the consignor is paid");
    }
  }
  try {
    await snapshotProfit(user, episodeId);
  } catch (e) {
    if (!(e instanceof FinanceError)) throw e; // snapshot may already exist
  }
  await changeEpisodeStatus(user, episodeId, "financial", "FINANCIALLY_CLOSED", "Financial close");
  await audit(user, { action: "episode.financial_close", resourceType: "episode", resourceId: episodeId });
}
