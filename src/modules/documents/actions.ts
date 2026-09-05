"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { storeDay } from "@/lib/dealership-date";
import { db } from "@/lib/db";
import { updateSaleDocumentInputs, completeSale, SalesError } from "@/modules/sales/service";
import {
  attachRequirementFile,
  evaluateSaleRequirements,
  overrideRequirement,
  setRequirementStep,
  RequirementError,
  type RequirementStep,
} from "./requirements";
import { MANUAL_ANSWER_FIELDS } from "./context";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndef, z.string().trim().optional());

function revalidateSale(saleId: string, episodeId?: string) {
  revalidatePath(`/sales/${saleId}`);
  revalidatePath("/sales");
  if (episodeId) revalidatePath(`/episodes/${episodeId}`);
}

/**
 * The Create Sale Docs form.
 *
 * Every field here is one the rules read. A blank field is left blank rather
 * than defaulted — the engine reports UNKNOWN, which is the correct and useful
 * answer while nobody has looked it up.
 */
const saleInputsSchema = z.object({
  saleId: z.string().uuid(),
  saleDate: optionalString,
  deliveryState: z.preprocess(emptyToUndef, z.string().trim().length(2).toUpperCase().optional()),
  deliveryMethod: z.preprocess(emptyToUndef, z.enum(["BUYER_PICKUP", "DEALER_DELIVERS", "COMMON_CARRIER"]).optional()),
  registrationState: z.preprocess(emptyToUndef, z.string().trim().length(2).toUpperCase().optional()),
  outsideLender: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  lenderPartyId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  coBuyerPartyId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  negotiatedLanguage: z.preprocess(emptyToUndef, z.enum(["EN", "ES", "OTHER"]).optional()),
  odometerAtSale: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).optional()),
  salesTaxCollected: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  reg51SerialNo: optionalString,
  tempPlateNo: optionalString,
});

export async function saveSaleDocumentInputsAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "sales");
  const parsed = saleInputsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { saleId, saleDate, ...rest } = parsed.data;

  // Checkbox groups only post the ticked boxes, so an unticked box is a real
  // "no" rather than an absence — but only for boxes the form actually showed.
  const answered = formData.get("manualAnswersPresent") === "1";
  const manualAnswers = answered
    ? Object.fromEntries(MANUAL_ANSWER_FIELDS.map((f) => [f.key, formData.get(f.key) === "on"]))
    : undefined;

  try {
    await updateSaleDocumentInputs(user, saleId, {
      ...rest,
      saleDate: saleDate ? storeDay(saleDate) : undefined,
      manualAnswers,
    });
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  const sale = await db.saleTransaction.findUnique({ where: { id: saleId }, select: { episodeId: true } });
  revalidateSale(saleId, sale?.episodeId);
}

const stepSchema = z.object({
  requirementId: z.string().uuid(),
  saleId: z.string().uuid(),
  step: z.enum([
    "buyerSigned",
    "dealerSigned",
    "consignorSigned",
    "originalReceived",
    "submitted",
    "buyerCopyProvided",
    "filed",
    "lookup",
  ]),
  done: z.preprocess((v) => v !== "false", z.boolean()),
});

export async function setRequirementStepAction(formData: FormData) {
  const user = await getSessionUser();
  // Asserts authentication; the specific permission is enforced in the service.
  requirePermission(user, "view", "documents");
  const parsed = stepSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await setRequirementStep(user, parsed.data.requirementId, parsed.data.step as RequirementStep, parsed.data.done);
  revalidateSale(parsed.data.saleId);
}

const overrideSchema = z.object({
  requirementId: z.string().uuid(),
  saleId: z.string().uuid(),
  state: z.enum(["REQUIRED", "NOT_REQUIRED", "CLEAR"]),
  reason: z.string().trim().default(""),
});

export async function overrideRequirementAction(formData: FormData) {
  const user = await getSessionUser();
  // Asserts authentication; the specific permission is enforced in the service.
  requirePermission(user, "view", "documents");
  const parsed = overrideSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { requirementId, saleId, state, reason } = parsed.data;
  try {
    await overrideRequirement(user, requirementId, state === "CLEAR" ? null : state, reason);
  } catch (e) {
    if (e instanceof RequirementError) return;
    throw e;
  }
  revalidateSale(saleId);
}

const attachSchema = z.object({
  requirementId: z.string().uuid(),
  saleId: z.string().uuid(),
  fileId: z.string().uuid(),
});

export async function attachRequirementFileAction(formData: FormData) {
  const user = await getSessionUser();
  // Asserts authentication; the specific permission is enforced in the service.
  requirePermission(user, "view", "documents");
  const parsed = attachSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await attachRequirementFile(user, parsed.data.requirementId, parsed.data.fileId);
  revalidateSale(parsed.data.saleId);
}

export async function reevaluateSaleAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "view", "documents");
  const saleId = z.string().uuid().safeParse(formData.get("saleId"));
  if (!saleId.success) return;
  await evaluateSaleRequirements(user, saleId.data);
  revalidateSale(saleId.data);
}

/** Admin only, and no override: this gate says the file itself is finished. */
export async function completeSaleAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "complete", "sales");
  const saleId = z.string().uuid().safeParse(formData.get("saleId"));
  if (!saleId.success) return;
  try {
    await completeSale(user, saleId.data);
  } catch (e) {
    if (e instanceof SalesError) return;
    throw e;
  }
  const sale = await db.saleTransaction.findUnique({ where: { id: saleId.data }, select: { episodeId: true } });
  revalidateSale(saleId.data, sale?.episodeId);
}
