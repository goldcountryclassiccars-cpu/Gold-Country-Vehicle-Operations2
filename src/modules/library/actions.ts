"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { LibraryError, sendFromLibrary } from "./service";
import { cancelEnvelope, EsignError, refreshEnvelope } from "@/modules/esign/service";

/** What the Library's send sheet shows after a try — refusals are words, never silence. */
export interface LibraryFormState {
  error?: string;
  notice?: string;
  saved?: number;
}

const optional = (max: number) => z.preprocess((v) => (v === "" ? undefined : v), z.string().max(max).optional());

const sendSchema = z.object({
  templateKey: z.string().min(1, "Pick a document."),
  episodeId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  contact: z.enum(["existing", "new"]),
  partyId: optional(64),
  newName: optional(120),
  newEmail: optional(200),
  newPhone: optional(40),
  method: z.enum(["ESIGN", "EMAIL_PDF"]),
  dealerUserId: optional(64),
  message: optional(2000),
});

export async function sendFromLibraryAction(_prev: LibraryFormState, formData: FormData): Promise<LibraryFormState> {
  const user = await getSessionUser();
  requirePermission(user, "send", "documents");
  const parsed = sendSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something in the form is missing." };
  const d = parsed.data;
  try {
    const result = await sendFromLibrary(user!, {
      templateKey: d.templateKey,
      episodeId: d.episodeId,
      partyId: d.contact === "existing" ? (d.partyId ?? null) : null,
      newParty: d.contact === "new" ? { displayName: d.newName ?? "", email: d.newEmail ?? "", phone: d.newPhone ?? null } : null,
      method: d.method,
      dealerUserId: d.dealerUserId ?? null,
      message: d.message ?? null,
    });
    revalidatePath("/documents/library");
    revalidatePath("/documents");
    if (d.episodeId) revalidatePath(`/episodes/${d.episodeId}`);
    const practice = result.practice ? " (practice mode — nothing actually left the app)" : "";
    return {
      notice:
        result.kind === "ESIGN"
          ? `Sent for signature. The contact gets an email with their signing link${practice}.`
          : `Emailed as a PDF${practice}.`,
      saved: Date.now(),
    };
  } catch (e) {
    if (e instanceof LibraryError) return { error: e.message };
    throw e;
  }
}

const envSchema = z.object({ envelopeId: z.string().uuid(), reason: optional(500) });

export async function refreshLibraryEnvelopeAction(_prev: LibraryFormState, formData: FormData): Promise<LibraryFormState> {
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
  revalidatePath("/documents/library");
  return { notice: "Status checked.", saved: Date.now() };
}

export async function cancelLibraryEnvelopeAction(_prev: LibraryFormState, formData: FormData): Promise<LibraryFormState> {
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
  revalidatePath("/documents/library");
  return { notice: "Canceled. The signing link no longer works; you can send again.", saved: Date.now() };
}
