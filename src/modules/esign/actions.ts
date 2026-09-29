"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { cancelEnvelope, EsignError, refreshEnvelope, sendForSignature } from "./service";

/** What the deal page's signature card shows after an action — refusals are words, never silence. */
export interface EsignFormState {
  error?: string;
  notice?: string;
  /** Changes on every success so the form remounts clean. */
  saved?: number;
}

function refresh(saleId: string) {
  revalidatePath(`/sales/${saleId}`);
  revalidatePath("/documents");
  revalidatePath("/closing");
}

const sendSchema = z.object({
  saleId: z.string().uuid(),
  dealerUserId: z.string().uuid({ message: "Choose who signs for the dealership." }),
  message: z.string().max(2000).optional(),
});

export async function sendForSignatureAction(_prev: EsignFormState, formData: FormData): Promise<EsignFormState> {
  const user = await getSessionUser();
  requirePermission(user, "send", "documents");
  const parsed = sendSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something in the form is missing." };
  try {
    await sendForSignature(user!, parsed.data.saleId, {
      dealerUserId: parsed.data.dealerUserId,
      message: parsed.data.message,
    });
  } catch (e) {
    if (e instanceof EsignError) return { error: e.message };
    throw e;
  }
  refresh(parsed.data.saleId);
  return { notice: "Sent. Each signer gets an email with their signing link.", saved: Date.now() };
}

const envSchema = z.object({ saleId: z.string().uuid(), envelopeId: z.string().uuid(), reason: z.string().max(500).optional() });

export async function refreshSignatureAction(_prev: EsignFormState, formData: FormData): Promise<EsignFormState> {
  const user = await getSessionUser();
  requirePermission(user, "view", "documents");
  const parsed = envSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Couldn't read that request." };
  try {
    await refreshEnvelope(user!, parsed.data.envelopeId);
  } catch (e) {
    if (e instanceof EsignError) return { error: e.message };
    throw e;
  }
  refresh(parsed.data.saleId);
  return { notice: "Status checked.", saved: Date.now() };
}

export async function cancelSignatureAction(_prev: EsignFormState, formData: FormData): Promise<EsignFormState> {
  const user = await getSessionUser();
  requirePermission(user, "send", "documents");
  const parsed = envSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Couldn't read that request." };
  try {
    await cancelEnvelope(user!, parsed.data.envelopeId, parsed.data.reason ?? "");
  } catch (e) {
    if (e instanceof EsignError) return { error: e.message };
    throw e;
  }
  refresh(parsed.data.saleId);
  return { notice: "Canceled. The signing links no longer work; you can fix the documents and send again.", saved: Date.now() };
}
