"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { createTransportJob, setTransportStatus, TransportError } from "./service";
import {
  approveSettlement,
  closeEpisodeFinancially,
  createSettlement,
  markSettlementPaid,
  SettlementError,
} from "@/modules/settlements/service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const jobSchema = z.object({
  episodeId: z.string().uuid(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  quoteAmount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  pickupLocation: z.preprocess(emptyToUndef, z.string().optional()),
  deliveryLocation: z.preprocess(emptyToUndef, z.string().optional()),
  pickupAt: z.preprocess(emptyToUndef, z.coerce.date().optional()),
  notes: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function createTransportJobAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "transport");
  const parsed = jobSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await createTransportJob(user, parsed.data);
  revalidatePath("/transport");
}

const jobStatusSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["QUOTE_REQUESTED", "QUOTED", "BOOKED", "PICKUP_SCHEDULED", "IN_TRANSIT", "DELIVERED", "CANCELED"]),
  actualCost: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  quoteAmount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
});

export async function setTransportStatusAction(formData: FormData) {
  const user = await getSessionUser();
  const parsed = jobStatusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const action = parsed.data.status === "DELIVERED" ? "complete" : "edit";
  requirePermission(user, action, "transport");
  try {
    await setTransportStatus(user, parsed.data.jobId, parsed.data.status, {
      actualCost: parsed.data.actualCost ?? undefined,
      quoteAmount: parsed.data.quoteAmount ?? undefined,
    });
  } catch (e) {
    if (e instanceof TransportError) return;
    throw e;
  }
  revalidatePath("/transport");
  revalidatePath("/expenses");
}

const episodeIdSchema = z.object({ episodeId: z.string().uuid() });

export async function createSettlementAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "settlements");
  const parsed = episodeIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await createSettlement(user, parsed.data.episodeId);
  } catch (e) {
    if (e instanceof SettlementError) return;
    throw e;
  }
  revalidatePath("/settlements");
  revalidatePath("/consignments");
}

const settlementIdSchema = z.object({
  settlementId: z.string().uuid(),
  reference: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function approveSettlementAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "approve", "approvals");
  const parsed = settlementIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await approveSettlement(user, parsed.data.settlementId);
  } catch (e) {
    if (e instanceof SettlementError) return;
    throw e;
  }
  revalidatePath("/settlements");
}

export async function markSettlementPaidAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "settlements");
  const parsed = settlementIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await markSettlementPaid(user, parsed.data.settlementId, parsed.data.reference);
  } catch (e) {
    if (e instanceof SettlementError) return;
    throw e;
  }
  revalidatePath("/settlements");
}

export async function closeEpisodeAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "settlements");
  const parsed = episodeIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await closeEpisodeFinancially(user, parsed.data.episodeId);
  } catch (e) {
    if (e instanceof SettlementError) return;
    throw e;
  }
  revalidatePath("/settlements");
  revalidatePath("/archive");
  revalidatePath("/profitability");
}
