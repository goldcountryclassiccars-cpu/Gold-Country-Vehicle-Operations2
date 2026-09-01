"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission, requireField } from "@/lib/authz/engine";
import { createExpense, setExpenseStatus, snapshotProfit, FinanceError } from "./service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const expenseSchema = z.object({
  episodeId: z.string().uuid(),
  categoryId: z.string().uuid(),
  description: z.string().trim().min(1),
  responsibility: z
    .enum(["DEALERSHIP", "CONSIGNOR", "BUYER_PASS_THROUGH", "SHARED", "REIMBURSABLE", "PENDING"])
    .default("DEALERSHIP"),
  estimatedAmount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  actualAmount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  notes: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function createExpenseAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "expenses");
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await createExpense(user, parsed.data);
  revalidatePath("/expenses");
  revalidatePath("/profitability");
  revalidatePath(`/episodes/${parsed.data.episodeId}`);
}

const expenseStatusSchema = z.object({
  expenseId: z.string().uuid(),
  status: z.enum(["ESTIMATED", "SUBMITTED", "APPROVED", "DECLINED", "COMMITTED", "INCURRED", "PAID", "REIMBURSED", "VOIDED"]),
  actualAmount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
});

export async function setExpenseStatusAction(formData: FormData) {
  const user = await getSessionUser();
  const parsed = expenseStatusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const action = parsed.data.status === "APPROVED" || parsed.data.status === "DECLINED" ? "approve" : "edit";
  requirePermission(user, action, "expenses");
  try {
    await setExpenseStatus(user, parsed.data.expenseId, parsed.data.status, {
      actualAmount: parsed.data.actualAmount ?? undefined,
    });
  } catch (e) {
    if (e instanceof FinanceError) return;
    throw e;
  }
  revalidatePath("/expenses");
  revalidatePath("/profitability");
}

const snapshotSchema = z.object({ episodeId: z.string().uuid() });

export async function snapshotProfitAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "view", "profitability");
  requireField(user, "profit");
  const parsed = snapshotSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await snapshotProfit(user, parsed.data.episodeId);
  } catch (e) {
    if (e instanceof FinanceError) return;
    throw e;
  }
  revalidatePath("/profitability");
}
