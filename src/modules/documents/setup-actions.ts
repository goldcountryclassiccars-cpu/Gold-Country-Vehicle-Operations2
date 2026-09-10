"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { clearApprovedTemplate, setSetupItem, TemplateError } from "./templates";

const answerSchema = z.object({
  key: z.string().min(1),
  provided: z.enum(["yes", "no"]),
  note: z.string().max(2000).default(""),
});

export async function setSetupItemAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = answerSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await setSetupItem(user, parsed.data.key, parsed.data.provided === "yes", parsed.data.note);
  revalidatePath("/admin/documents");
  revalidatePath("/admin");
  revalidatePath("/documents");
}

const clearSchema = z.object({
  templateKey: z.string().min(1),
  reason: z.string().default(""),
});

export async function clearApprovedTemplateAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = clearSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await clearApprovedTemplate(user, parsed.data.templateKey, parsed.data.reason);
  } catch (e) {
    if (e instanceof TemplateError) return;
    throw e;
  }
  revalidatePath("/admin/documents");
  revalidatePath("/documents");
}
