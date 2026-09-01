"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import {
  cancelSale,
  createSale,
  deliverVehicle,
  markContracted,
  recordPayment,
  releaseVehicle,
  SalesError,
  setPaymentStatus,
} from "./service";
import { fileDocument, generateDocument, markDocumentSigned, sendDocument, DocumentError } from "@/modules/documents/service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

function revalidateSale(saleId?: string, episodeId?: string) {
  revalidatePath("/sales");
  revalidatePath("/closing");
  revalidatePath("/documents");
  if (saleId) revalidatePath(`/sales/${saleId}`);
  if (episodeId) revalidatePath(`/episodes/${episodeId}`);
}

const newSaleSchema = z.object({
  episodeId: z.string().uuid(),
  agreedPrice: z.coerce.number().min(0),
  depositAmount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  buyerName: z.string().trim().min(1),
  buyerEmail: z.preprocess(emptyToUndef, z.string().email().optional()),
  buyerPhone: z.preprocess(emptyToUndef, z.string().optional()),
  buyerCity: z.preprocess(emptyToUndef, z.string().optional()),
  buyerState: z.preprocess(emptyToUndef, z.string().optional()),
  notes: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function createSaleAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "sales");
  const parsed = newSaleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const d = parsed.data;
  let saleId: string;
  try {
    const sale = await createSale(user, {
      episodeId: d.episodeId,
      agreedPrice: d.agreedPrice,
      depositAmount: d.depositAmount ?? null,
      notes: d.notes ?? null,
      buyer: { displayName: d.buyerName, email: d.buyerEmail, phone: d.buyerPhone, city: d.buyerCity, state: d.buyerState },
    });
    saleId = sale.id;
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  revalidateSale(saleId, d.episodeId);
  redirect(`/sales/${saleId}`);
}

const paymentSchema = z.object({
  saleId: z.string().uuid(),
  kind: z.enum(["DEPOSIT", "DOWN_PAYMENT", "FINAL", "REFUND"]),
  method: z.enum(["WIRE", "CHECK", "CASH", "CARD", "FINANCING", "OTHER"]),
  amount: z.coerce.number().min(0.01),
  status: z.enum(["EXPECTED", "RECEIVED", "CLEARED"]).default("RECEIVED"),
  reference: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function recordPaymentAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "payments");
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await recordPayment(user, parsed.data);
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}

const paymentStatusSchema = z.object({
  paymentId: z.string().uuid(),
  saleId: z.string().uuid(),
  status: z.enum(["RECEIVED", "CLEARED", "REFUNDED", "FAILED"]),
});

export async function setPaymentStatusAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "payments");
  const parsed = paymentStatusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await setPaymentStatus(user, parsed.data.paymentId, parsed.data.status);
  revalidateSale(parsed.data.saleId);
}

const saleIdSchema = z.object({ saleId: z.string().uuid() });

export async function markContractedAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "sales");
  const parsed = saleIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await markContracted(user, parsed.data.saleId);
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}

const releaseSchema = z.object({
  saleId: z.string().uuid(),
  overrideReason: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function releaseVehicleAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "sales");
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await releaseVehicle(user, parsed.data.saleId, parsed.data.overrideReason);
  revalidateSale(parsed.data.saleId);
}

export async function deliverVehicleAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "sales");
  const parsed = saleIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await deliverVehicle(user, parsed.data.saleId);
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
  revalidatePath("/integrations");
}

const cancelSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3),
  unwind: z.coerce.boolean().default(false),
});

export async function cancelSaleAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "sales");
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await cancelSale(user, parsed.data.saleId, parsed.data.reason, parsed.data.unwind);
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}

// ---- Documents ------------------------------------------------------------

const genDocSchema = z.object({ saleId: z.string().uuid(), templateId: z.string().uuid() });

export async function generateDocumentAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "generate", "documents");
  const parsed = genDocSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await generateDocument(user, parsed.data.saleId, parsed.data.templateId);
  } catch (e) {
    if (e instanceof DocumentError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}

const docIdSchema = z.object({ documentId: z.string().uuid(), saleId: z.string().uuid() });

export async function sendDocumentAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "send", "documents");
  const parsed = docIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await sendDocument(user, parsed.data.documentId);
  } catch (e) {
    if (e instanceof DocumentError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}

export async function markDocumentSignedAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "documents");
  const parsed = docIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await markDocumentSigned(user, parsed.data.documentId);
  } catch (e) {
    if (e instanceof DocumentError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}

export async function fileDocumentAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "documents");
  const parsed = docIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await fileDocument(user, parsed.data.documentId);
  } catch (e) {
    if (e instanceof DocumentError) return;
    throw e;
  }
  revalidateSale(parsed.data.saleId);
}
