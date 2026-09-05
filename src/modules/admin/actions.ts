"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { destroyAllSessionsForUser } from "@/lib/auth/session";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const newUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Use at least 10 characters"),
  roleKey: z.string().min(1),
  departmentId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
});

export async function createUserAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = newUserSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const d = parsed.data;
  const role = await db.role.findUnique({ where: { key: d.roleKey } });
  if (!role) return;
  const existing = await db.user.findUnique({ where: { email: d.email } });
  if (existing) return;
  const created = await db.user.create({
    data: {
      name: d.name,
      email: d.email,
      passwordHash: await hashPassword(d.password),
      primaryDepartmentId: d.departmentId ?? null,
      roles: { create: { roleId: role.id } },
      departments: d.departmentId ? { create: { departmentId: d.departmentId } } : undefined,
    },
  });
  await audit(user, { action: "admin.user.create", resourceType: "user", resourceId: created.id, newValues: { email: d.email, role: d.roleKey } });
  revalidatePath("/admin");
}

const toggleSchema = z.object({ userId: z.string().uuid() });

export async function toggleUserActiveAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const target = await db.user.findUniqueOrThrow({ where: { id: parsed.data.userId } });
  if (target.id === user.id) return; // cannot disable yourself
  const updated = await db.user.update({ where: { id: target.id }, data: { active: !target.active } });
  if (!updated.active) await destroyAllSessionsForUser(target.id); // immediate lockout
  await audit(user, {
    action: updated.active ? "admin.user.enable" : "admin.user.disable",
    resourceType: "user",
    resourceId: target.id,
    previousValues: { active: target.active },
    newValues: { active: updated.active },
  });
  revalidatePath("/admin");
}

const resetPasswordSchema = z.object({ userId: z.string().uuid(), password: z.string().min(10) });

export async function resetPasswordAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await db.user.update({
    where: { id: parsed.data.userId },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  });
  await destroyAllSessionsForUser(parsed.data.userId);
  await audit(user, { action: "admin.user.reset_password", resourceType: "user", resourceId: parsed.data.userId });
  revalidatePath("/admin");
}

const resetRoleSchema = z.object({ roleKey: z.string().min(1) });

/** Resets one role's grants to the shipped template (owner is always full). */
export async function resetRoleToTemplateAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = resetRoleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const tpl = ROLE_TEMPLATES.find((t) => t.key === parsed.data.roleKey);
  if (!tpl) return;
  const role = await db.role.findUnique({ where: { key: tpl.key } });
  if (!role) return;
  await db.rolePermission.deleteMany({ where: { roleId: role.id } });
  await db.roleFieldGrant.deleteMany({ where: { roleId: role.id } });
  const rows = Object.entries(tpl.grants).flatMap(([resource, grant]) =>
    Object.entries(grant!).map(([action, scope]) => ({ roleId: role.id, resource, action, scope: scope as never })),
  );
  if (rows.length) await db.rolePermission.createMany({ data: rows });
  if (tpl.fieldGrants.length) {
    await db.roleFieldGrant.createMany({ data: tpl.fieldGrants.map((fieldKey) => ({ roleId: role.id, fieldKey })) });
  }
  await audit(user, { action: "admin.role.reset", resourceType: "role", resourceId: role.id, newValues: { key: tpl.key } });
  revalidatePath("/admin");
}

const settingsSchema = z.object({
  stockPrefix: z.string().trim().min(1).max(6),
  stockNext: z.coerce.number().int().min(1),
  settlementDays: z.coerce.number().int().min(1).max(120),
});

/**
 * Dealer identity, as it appears on every document.
 *
 * Admin-only to edit, readable by the front desk — Rose needs the license
 * number to fill in a REG 51, and none of it is secret in the way a purchase
 * price is. The values are entered here rather than committed to code, so the
 * dealer license and seller's permit numbers never appear in the repository.
 */
const dealerSchema = z.object({
  legalName: z.string().trim().max(200).optional(),
  dba: z.string().trim().max(200).optional(),
  address: z.string().trim().max(400).optional(),
  dealerLicenseNo: z.string().trim().max(60).optional(),
  sellersPermitNo: z.string().trim().max(60).optional(),
});

export async function updateDealerConfigAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = dealerSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;

  const changed: string[] = [];
  for (const [field, value] of Object.entries(parsed.data)) {
    if (value === undefined || value === "") continue;
    const key = `dealer.${field}`;
    await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    changed.push(key);
  }
  if (changed.length === 0) return;
  // The keys, never the values — a dealer license number should not land in an
  // audit payload that gets exported.
  await audit(user, { action: "admin.dealer_config.update", newValues: { keys: changed } });
  revalidatePath("/admin");
}

export async function updateSettingsAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const d = parsed.data;
  const current = await db.appSetting.findUnique({ where: { key: "stock_number" } });
  const cfg = { prefix: "GC", nextNumber: 1001, padding: 4, ...((current?.value as object) ?? {}) };
  await db.appSetting.upsert({
    where: { key: "stock_number" },
    update: { value: { ...cfg, prefix: d.stockPrefix, nextNumber: d.stockNext } },
    create: { key: "stock_number", value: { prefix: d.stockPrefix, nextNumber: d.stockNext, padding: 4 } },
  });
  await db.appSetting.upsert({
    where: { key: "settlement_deadline_days" },
    update: { value: d.settlementDays },
    create: { key: "settlement_deadline_days", value: d.settlementDays },
  });
  await audit(user, { action: "admin.settings.update", newValues: d });
  revalidatePath("/admin");
}
