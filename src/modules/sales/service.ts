/**
 * Phase 6 sales services: deals, payments, release gate, delivery, cancel.
 * Sale status drives the episode's sales dimension (with history + audit).
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";
import { requireOwnerOverride } from "@/lib/authz/engine";
import { changeEpisodeStatus } from "@/modules/episodes/service";
import { emitIntegrationEvent } from "@/modules/media/service";

export class SalesError extends Error {}

export async function createSale(
  user: SessionUser,
  input: {
    episodeId: string;
    agreedPrice: number;
    depositAmount?: number | null;
    salespersonId?: string | null;
    notes?: string | null;
    buyer: { displayName: string; email?: string | null; phone?: string | null; city?: string | null; state?: string | null };
  },
) {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: input.episodeId } });
  if (["CONTRACTED", "FUNDS_PENDING", "FUNDED", "READY_FOR_RELEASE", "RELEASED", "DELIVERED"].includes(episode.salesStatus)) {
    throw new SalesError("This vehicle already has an active deal");
  }
  const buyer = await db.party.create({
    data: {
      kind: "PERSON",
      displayName: input.buyer.displayName,
      email: input.buyer.email ?? null,
      phone: input.buyer.phone ?? null,
      city: input.buyer.city ?? null,
      state: input.buyer.state ?? null,
      createdById: user.id,
    },
  });
  const sale = await db.saleTransaction.create({
    data: {
      episodeId: input.episodeId,
      buyerPartyId: buyer.id,
      salespersonId: input.salespersonId ?? user.id,
      agreedPrice: input.agreedPrice,
      depositAmount: input.depositAmount ?? null,
      notes: input.notes ?? null,
      status: "DEPOSIT_REQUESTED",
      createdById: user.id,
    },
  });
  await changeEpisodeStatus(user, input.episodeId, "sales", "DEPOSIT_REQUESTED", `Deal opened for ${buyer.displayName}`);
  await audit(user, {
    action: "sale.create",
    resourceType: "sale",
    resourceId: sale.id,
    newValues: { episodeId: input.episodeId, agreedPrice: input.agreedPrice },
  });
  return sale;
}

/** Records a payment; cleared payments advance the deal + episode status. */
export async function recordPayment(
  user: SessionUser,
  input: {
    saleId: string;
    kind: "DEPOSIT" | "DOWN_PAYMENT" | "FINAL" | "REFUND";
    method: "WIRE" | "CHECK" | "CASH" | "CARD" | "FINANCING" | "OTHER";
    amount: number;
    status?: "EXPECTED" | "RECEIVED" | "CLEARED";
    reference?: string | null;
  },
) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: input.saleId } });
  if (["CANCELED", "UNWOUND", "COMPLETE"].includes(sale.status)) throw new SalesError("Deal is closed");
  const status = input.status ?? "RECEIVED";
  const payment = await db.payment.create({
    data: {
      saleId: sale.id,
      kind: input.kind,
      method: input.method,
      status: status as never,
      amount: input.amount,
      reference: input.reference ?? null,
      receivedAt: status !== "EXPECTED" ? new Date() : null,
      clearedAt: status === "CLEARED" ? new Date() : null,
      recordedById: user.id,
    },
  });
  await audit(user, {
    action: "payment.record",
    resourceType: "sale",
    resourceId: sale.id,
    newValues: { kind: input.kind, amount: input.amount, status },
  });
  await advanceSaleFromPayments(user, sale.id);
  return payment;
}

export async function setPaymentStatus(user: SessionUser, paymentId: string, status: "RECEIVED" | "CLEARED" | "REFUNDED" | "FAILED") {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  await db.payment.update({
    where: { id: paymentId },
    data: {
      status: status as never,
      receivedAt: status === "RECEIVED" && !payment.receivedAt ? new Date() : undefined,
      clearedAt: status === "CLEARED" ? new Date() : undefined,
    },
  });
  await audit(user, {
    action: "payment.status",
    resourceType: "sale",
    resourceId: payment.saleId,
    previousValues: { status: payment.status },
    newValues: { status },
  });
  await advanceSaleFromPayments(user, payment.saleId);
}

/** Derives deal + episode sales status from payment state. */
async function advanceSaleFromPayments(user: SessionUser, saleId: string) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId }, include: { payments: true } });
  if (["RELEASED", "DELIVERED", "COMPLETE", "CANCELED", "UNWOUND"].includes(sale.status)) return;

  const cleared = sale.payments
    .filter((p) => p.status === "CLEARED" && p.kind !== "REFUND")
    .reduce((s, p) => s + Number(p.amount), 0);
  const anyDeposit = sale.payments.some((p) => p.kind === "DEPOSIT" && (p.status === "RECEIVED" || p.status === "CLEARED"));

  let next: string | null = null;
  if (cleared >= Number(sale.agreedPrice)) next = "FUNDED";
  else if (sale.status === "CONTRACTED" && sale.payments.some((p) => p.status === "RECEIVED" || p.status === "CLEARED")) next = "FUNDS_PENDING";
  else if (anyDeposit && (sale.status === "DRAFT" || sale.status === "DEPOSIT_REQUESTED")) next = "DEPOSIT_RECEIVED";

  if (next && next !== sale.status) {
    await db.saleTransaction.update({ where: { id: saleId }, data: { status: next as never } });
    await changeEpisodeStatus(user, sale.episodeId, "sales", next, "Payment activity");
  }
}

export async function markContracted(user: SessionUser, saleId: string) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  if (!["DEPOSIT_REQUESTED", "DEPOSIT_RECEIVED", "DRAFT"].includes(sale.status)) {
    throw new SalesError("Deal cannot be contracted from its current state");
  }
  await db.saleTransaction.update({ where: { id: saleId }, data: { status: "CONTRACTED", contractedAt: new Date() } });
  await changeEpisodeStatus(user, sale.episodeId, "sales", "CONTRACTED", "Purchase agreement in place");
  await audit(user, { action: "sale.contracted", resourceType: "sale", resourceId: saleId });
}

export interface ReleaseGate {
  funded: boolean;
  docsSigned: boolean;
  ok: boolean;
}

export async function releaseGate(saleId: string): Promise<ReleaseGate> {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId }, include: { documents: true } });
  const funded = sale.status === "FUNDED";
  const docs = sale.documents.filter((d) => d.status !== "VOIDED");
  const docsSigned = docs.length > 0 && docs.every((d) => d.status === "SIGNED" || d.status === "FILED");
  return { funded, docsSigned, ok: funded && docsSigned };
}

/**
 * Releases the vehicle. The gate (funded + docs signed) can only be bypassed
 * by a REAL owner with a recorded reason — audited as an override.
 */
export async function releaseVehicle(user: SessionUser, saleId: string, overrideReason?: string) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  const gate = await releaseGate(saleId);
  let overridden = false;
  if (!gate.ok) {
    requireOwnerOverride(user, overrideReason ?? "");
    overridden = true;
  }
  await db.saleTransaction.update({
    where: { id: saleId },
    data: {
      status: "RELEASED",
      releasedAt: new Date(),
      releasedById: user.id,
      releaseReason: overridden ? overrideReason : null,
    },
  });
  await changeEpisodeStatus(user, sale.episodeId, "sales", "RELEASED", overridden ? `OWNER OVERRIDE: ${overrideReason}` : "Release gate satisfied");
  await audit(user, {
    action: overridden ? "release.override" : "release.normal",
    resourceType: "sale",
    resourceId: saleId,
    reason: overrideReason,
    newValues: { gate },
  });
}

export async function deliverVehicle(user: SessionUser, saleId: string) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId }, include: { payments: true } });
  if (sale.status !== "RELEASED") throw new SalesError("Vehicle must be released before delivery");
  await db.saleTransaction.update({ where: { id: saleId }, data: { status: "DELIVERED", deliveredAt: new Date() } });
  await changeEpisodeStatus(user, sale.episodeId, "sales", "DELIVERED", "Vehicle delivered");
  await changeEpisodeStatus(user, sale.episodeId, "marketing", "MARKED_SOLD", "Vehicle delivered");
  await emitIntegrationEvent("vehicle.sold", sale.episodeId, {
    episodeId: sale.episodeId,
    saleId,
    deliveredAt: new Date().toISOString(),
  });
  await audit(user, { action: "sale.delivered", resourceType: "sale", resourceId: saleId });
}

export async function cancelSale(user: SessionUser, saleId: string, reason: string, unwind = false) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  if (["CANCELED", "UNWOUND", "COMPLETE"].includes(sale.status)) throw new SalesError("Deal already closed");
  const status = unwind ? "UNWOUND" : "CANCELED";
  await db.saleTransaction.update({
    where: { id: saleId },
    data: { status: status as never, canceledAt: new Date(), cancelReason: reason },
  });
  // Vehicle returns to available inventory; history preserves the failed deal.
  await changeEpisodeStatus(user, sale.episodeId, "sales", unwind ? "UNWOUND" : "CANCELED", reason);
  await changeEpisodeStatus(user, sale.episodeId, "sales", "AVAILABLE", "Returned to available after canceled deal");
  await audit(user, { action: unwind ? "sale.unwound" : "sale.canceled", resourceType: "sale", resourceId: saleId, reason });
}

/** Latest sale price for profitability (delivered/active deal beats asking). */
export async function currentSalePrice(episodeId: string): Promise<number | null> {
  const sale = await db.saleTransaction.findFirst({
    where: { episodeId, status: { notIn: ["CANCELED", "UNWOUND"] } },
    orderBy: { createdAt: "desc" },
  });
  return sale ? Number(sale.agreedPrice) : null;
}
