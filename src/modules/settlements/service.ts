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
  const sale = await db.saleTransaction.findFirstOrThrow({
    where: { episodeId, status: { in: ["DELIVERED", "COMPLETE", "RELEASED", "FUNDED"] } },
    orderBy: { createdAt: "desc" },
  });
  const c = await computeSettlement(episodeId);

  const deadlineSetting = await db.appSetting.findUnique({ where: { key: "settlement_deadline_days" } });
  const days = typeof deadlineSetting?.value === "number" ? deadlineSetting.value : 14;
  const anchor = sale.deliveredAt ?? new Date();

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
      dueBy: new Date(anchor.getTime() + days * 86400_000),
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
