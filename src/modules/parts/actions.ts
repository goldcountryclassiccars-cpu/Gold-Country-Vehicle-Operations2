"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { createPartRequest, PartsError, removePartRequest, setPartOrdered } from "./service";

/** Every form on this page reports its outcome; nothing fails silently. */
export interface PartsFormState {
  error?: string;
  saved?: number; // increments so the add form clears after each success
}

const createSchema = z.object({
  description: z.string().trim().min(1, "Say what's needed."),
  requestedByName: z.string().trim().min(1, "Put your name in “Requested by”."),
});

export async function createPartRequestAction(prev: PartsFormState, formData: FormData): Promise<PartsFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "parts");
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await createPartRequest(user, parsed.data);
  } catch (e) {
    if (e instanceof PartsError) return { error: e.message };
    throw e;
  }
  revalidatePath("/parts");
  revalidatePath("/dashboard");
  return { saved: (prev.saved ?? 0) + 1 };
}

export async function setPartOrderedAction(_prev: PartsFormState, formData: FormData): Promise<PartsFormState> {
  const user = await getSessionUser();
  requirePermission(user, "edit", "parts");
  const id = String(formData.get("id") ?? "");
  const ordered = formData.get("ordered") === "1";
  if (!id) return { error: "Something went wrong — reload the page and try again." };
  try {
    await setPartOrdered(user, id, ordered);
  } catch (e) {
    if (e instanceof PartsError) return { error: e.message };
    throw e;
  }
  revalidatePath("/parts");
  revalidatePath("/dashboard");
  return {};
}

export async function removePartRequestAction(_prev: PartsFormState, formData: FormData): Promise<PartsFormState> {
  const user = await getSessionUser();
  requirePermission(user, "edit", "parts");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Something went wrong — reload the page and try again." };
  await removePartRequest(user, id);
  revalidatePath("/parts");
  revalidatePath("/dashboard");
  return {};
}
