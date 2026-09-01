/**
 * Phase 7 transport services. Outbound delivery updates the episode custody
 * dimension; costs land in the expense ledger.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";
import { changeEpisodeStatus } from "@/modules/episodes/service";
import { createExpense } from "@/modules/finance/service";

export class TransportError extends Error {}

const TRANSITIONS: Record<string, string[]> = {
  QUOTE_REQUESTED: ["QUOTED", "CANCELED"],
  QUOTED: ["BOOKED", "QUOTE_REQUESTED", "CANCELED"],
  BOOKED: ["PICKUP_SCHEDULED", "CANCELED"],
  PICKUP_SCHEDULED: ["IN_TRANSIT", "CANCELED"],
  IN_TRANSIT: ["DELIVERED"],
  DELIVERED: [],
  CANCELED: [],
};

export async function createTransportJob(
  user: SessionUser,
  input: {
    episodeId: string;
    direction: "INBOUND" | "OUTBOUND";
    saleId?: string | null;
    carrierPartyId?: string | null;
    coordinatorId?: string | null;
    quoteAmount?: number | null;
    pickupLocation?: string | null;
    deliveryLocation?: string | null;
    pickupAt?: Date | null;
    notes?: string | null;
  },
) {
  const job = await db.transportJob.create({
    data: {
      episodeId: input.episodeId,
      direction: input.direction,
      saleId: input.saleId ?? null,
      carrierPartyId: input.carrierPartyId ?? null,
      coordinatorId: input.coordinatorId ?? user.id,
      quoteAmount: input.quoteAmount ?? null,
      pickupLocation: input.pickupLocation ?? null,
      deliveryLocation: input.deliveryLocation ?? null,
      pickupAt: input.pickupAt ?? null,
      notes: input.notes ?? null,
      status: input.quoteAmount != null ? "QUOTED" : "QUOTE_REQUESTED",
      createdById: user.id,
    },
  });
  await audit(user, { action: "transport.create", resourceType: "transport", resourceId: job.id, newValues: { episodeId: input.episodeId, direction: input.direction } });
  return job;
}

export async function setTransportStatus(
  user: SessionUser,
  jobId: string,
  status: keyof typeof TRANSITIONS,
  opts?: { actualCost?: number | null; quoteAmount?: number | null },
) {
  const job = await db.transportJob.findUniqueOrThrow({ where: { id: jobId } });
  const allowed = TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(status)) throw new TransportError(`Cannot move transport from ${job.status} to ${status}`);

  const updated = await db.transportJob.update({
    where: { id: jobId },
    data: {
      status: status as never,
      quoteAmount: opts?.quoteAmount ?? undefined,
      actualCost: opts?.actualCost ?? undefined,
      deliveredAt: status === "DELIVERED" ? new Date() : undefined,
    },
  });

  // Custody follows outbound transport progress.
  if (job.direction === "OUTBOUND") {
    if (status === "IN_TRANSIT") await changeEpisodeStatus(user, job.episodeId, "custody", "CARRIER_POSSESSION", "Outbound transport in transit");
    if (status === "DELIVERED") await changeEpisodeStatus(user, job.episodeId, "custody", "DELIVERED", "Outbound transport delivered");
  } else if (job.direction === "INBOUND" && status === "IN_TRANSIT") {
    await changeEpisodeStatus(user, job.episodeId, "custody", "INBOUND_TRANSPORT", "Inbound transport in transit");
  }

  // Delivered with a cost → ledger entry (buyer transport is usually pass-through).
  if (status === "DELIVERED" && (opts?.actualCost ?? job.actualCost ?? job.quoteAmount)) {
    const amount = Number(opts?.actualCost ?? job.actualCost ?? job.quoteAmount);
    const category =
      (await db.expenseCategory.findUnique({ where: { key: "transport_in" } })) ??
      (await db.expenseCategory.findFirstOrThrow());
    await createExpense(user, {
      episodeId: job.episodeId,
      categoryId: category.id,
      description: `${job.direction === "INBOUND" ? "Inbound" : "Outbound"} transport`,
      responsibility: job.direction === "OUTBOUND" ? "BUYER_PASS_THROUGH" : "DEALERSHIP",
      actualAmount: amount,
      status: "INCURRED",
      vendorPartyId: job.carrierPartyId,
    });
  }

  await audit(user, {
    action: "transport.status",
    resourceType: "transport",
    resourceId: jobId,
    previousValues: { status: job.status },
    newValues: { status },
  });
  return updated;
}
