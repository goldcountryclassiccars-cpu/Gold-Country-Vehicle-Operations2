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
import { evaluateSaleRequirements, saleComplianceSummary } from "@/modules/documents/requirements";
import { readManualAnswers } from "@/modules/documents/context";
import type { Prisma } from "@prisma/client";
import { dealershipDayString, readDay, storeDay } from "@/lib/dealership-date";

export class SalesError extends Error {}

/**
 * A deal cannot leave DRAFT while the odometer reading is unverified.
 *
 * mileageStatus is the odometer disclosure. Letting a sale progress on UNKNOWN
 * means signing a federal disclosure nobody has actually checked — and the
 * import deliberately defaults every bulk-loaded car to UNKNOWN, so this is a
 * live case rather than a theoretical one.
 */
export async function assertMileageKnown(episodeId: string) {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { vehicle: true },
  });
  if (episode.vehicle.mileageStatus === "UNKNOWN") {
    throw new SalesError(
      "Set the odometer status on the vehicle record before opening a deal — it is the odometer disclosure, and it is never inferred from the model year.",
    );
  }
}

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
  await assertMileageKnown(input.episodeId);
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
  await evaluateSaleRequirements(user, sale.id);
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
  await evaluateSaleRequirements(user, sale.id);
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
  await evaluateSaleRequirements(user, payment.saleId);
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
  await assertMileageKnown(sale.episodeId);
  const contractedAt = new Date();
  await db.saleTransaction.update({
    where: { id: saleId },
    // contractedAt stays a real instant (it is a timestamp); saleDate is the
    // calendar day the statutory cut-overs turn on, so it is normalised.
    data: { status: "CONTRACTED", contractedAt, saleDate: sale.saleDate ?? storeDay(contractedAt) },
  });
  await changeEpisodeStatus(user, sale.episodeId, "sales", "CONTRACTED", "Purchase agreement in place");
  await audit(user, { action: "sale.contracted", resourceType: "sale", resourceId: saleId });
  await evaluateSaleRequirements(user, saleId);
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
  const deliveredAt = new Date();
  await db.saleTransaction.update({
    where: { id: saleId },
    data: {
      status: "DELIVERED",
      deliveredAt,
      deliveredToBuyerAt: sale.deliveredToBuyerAt ?? deliveredAt,
      cancellationWindowEndsAt: sale.cancellationWindowEndsAt ?? cancellationWindowFrom(sale.saleDate, deliveredAt),
    },
  });
  await changeEpisodeStatus(user, sale.episodeId, "sales", "DELIVERED", "Vehicle delivered");
  await changeEpisodeStatus(user, sale.episodeId, "marketing", "MARKED_SOLD", "Vehicle delivered");
  await emitIntegrationEvent("vehicle.sold", sale.episodeId, {
    episodeId: sale.episodeId,
    saleId,
    deliveredAt: new Date().toISOString(),
  });
  await audit(user, { action: "sale.delivered", resourceType: "sale", resourceId: saleId });
  await evaluateSaleRequirements(user, saleId);
}

/**
 * CARS Act 3-day cancellation window, for sales on or after 2026-10-01.
 *
 * Ends at close of business on the third calendar day after delivery. 18:00
 * local stands in for "close of business"; weekend and holiday handling still
 * needs confirming with counsel, which is why the field stays editable rather
 * than being computed and locked.
 */
export function cancellationWindowFrom(saleDate: Date | null, deliveredAt: Date): Date | null {
  const effective = saleDate ? readDay(saleDate) : dealershipDayString(deliveredAt);
  if (!effective || effective < "2026-10-01") return null;
  const end = new Date(deliveredAt);
  end.setDate(end.getDate() + 3);
  end.setHours(18, 0, 0, 0);
  return end;
}

/**
 * Records the sale-time answers the document rules read, then re-evaluates.
 *
 * Deliberately settable while the deal is still a draft: the whole point is
 * that an employee can see what paperwork a deal needs *before* committing to
 * it, not after.
 */
export async function updateSaleDocumentInputs(
  user: SessionUser,
  saleId: string,
  input: {
    saleDate?: Date | null;
    deliveryState?: string | null;
    deliveryMethod?: "BUYER_PICKUP" | "DEALER_DELIVERS" | "COMMON_CARRIER" | null;
    registrationState?: string | null;
    outsideLender?: boolean;
    lenderPartyId?: string | null;
    negotiatedLanguage?: "EN" | "ES" | "OTHER" | null;
    reg51SerialNo?: string | null;
    tempPlateNo?: string | null;
    odometerAtSale?: number | null;
    salesTaxCollected?: number | null;
    cancellationWindowEndsAt?: Date | null;
    coBuyerPartyId?: string | null;
    manualAnswers?: Record<string, boolean>;
  },
) {
  const before = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  if (["CANCELED", "UNWOUND", "COMPLETE"].includes(before.status)) throw new SalesError("Deal is closed");

  const { manualAnswers, ...scalar } = input;
  // Merge rather than replace: the form posts one section at a time, and a
  // partial payload must not blank an answer somebody already gave.
  const mergedManual: Prisma.InputJsonValue | undefined = manualAnswers
    ? ({ ...readManualAnswers(before.manualAnswers), ...manualAnswers } as Prisma.InputJsonValue)
    : undefined;

  await db.saleTransaction.update({
    where: { id: saleId },
    data: { ...scalar, ...(mergedManual ? { manualAnswers: mergedManual } : {}) },
  });
  await audit(user, {
    action: "sale.document_inputs",
    resourceType: "sale",
    resourceId: saleId,
    previousValues: {
      saleDate: before.saleDate,
      deliveryState: before.deliveryState,
      deliveryMethod: before.deliveryMethod,
      registrationState: before.registrationState,
    },
    newValues: { ...scalar, manualAnswers },
  });
  await evaluateSaleRequirements(user, saleId);
}

export interface CompletionGate {
  compliance: Awaited<ReturnType<typeof saleComplianceSummary>>;
  funded: boolean;
  ok: boolean;
}

/** The additional gate on COMPLETE: every required-or-unknown row must be done. */
export async function completionGate(saleId: string): Promise<CompletionGate> {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  const compliance = await saleComplianceSummary(saleId);
  const funded = ["FUNDED", "RELEASED", "DELIVERED", "COMPLETE"].includes(sale.status);
  return { compliance, funded, ok: funded && compliance.ok };
}

/**
 * Closes the deal.
 *
 * Two gates, both of which must pass: the existing release gate already got the
 * car out of the door, and this one says the paperwork behind it is finished.
 * An UNKNOWN requirement blocks exactly like a missing signature — "we never
 * asked" is not a state a closed deal may be left in.
 *
 * Admin only (`sales:complete`), and there is no override: an override here
 * would mean signing off a file that the app itself says is incomplete.
 */
export async function completeSale(user: SessionUser, saleId: string) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  if (sale.status !== "DELIVERED") throw new SalesError("Only a delivered deal can be completed");

  await evaluateSaleRequirements(user, saleId);
  const gate = await completionGate(saleId);
  if (!gate.compliance.ok) {
    const names = gate.compliance.blockers.slice(0, 3).map((b) => b.name).join(", ");
    throw new SalesError(
      `${gate.compliance.blockers.length} document requirement(s) still outstanding: ${names}${gate.compliance.blockers.length > 3 ? "…" : ""}`,
    );
  }

  await db.saleTransaction.update({ where: { id: saleId }, data: { status: "COMPLETE" } });
  await changeEpisodeStatus(user, sale.episodeId, "document", "FILED", "All document requirements complete");
  await audit(user, {
    action: "sale.complete",
    resourceType: "sale",
    resourceId: saleId,
    newValues: { requirements: gate.compliance.requiredCount },
  });
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
