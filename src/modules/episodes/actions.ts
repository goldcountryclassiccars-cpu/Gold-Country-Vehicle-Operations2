"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission, requireField } from "@/lib/authz/engine";
import { changeEpisodeStatus, setAskingPrice, STATUS_DIMENSIONS, StatusError, type StatusDimension } from "./service";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

const statusSchema = z.object({
  episodeId: z.string().uuid(),
  dimension: z.enum(Object.keys(STATUS_DIMENSIONS) as [StatusDimension, ...StatusDimension[]]),
  toValue: z.string().min(1),
  reason: z.string().optional(),
});

export async function changeStatusAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "episodes");
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { episodeId, dimension, toValue, reason } = parsed.data;
  try {
    await changeEpisodeStatus(user, episodeId, dimension, toValue, reason);
  } catch (e) {
    if (e instanceof StatusError) return;
    throw e;
  }
  revalidatePath(`/episodes/${episodeId}`);
  revalidatePath("/pipeline");
}

const priceSchema = z.object({
  episodeId: z.string().uuid(),
  askingPrice: z.coerce.number().min(0),
  reason: z.string().optional(),
});

export async function setPriceAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "episodes");
  const parsed = priceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await setAskingPrice(user, parsed.data.episodeId, parsed.data.askingPrice, parsed.data.reason);
  revalidatePath(`/episodes/${parsed.data.episodeId}`);
}

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const arrangementSchema = z.object({
  episodeId: z.string().uuid(),
  purchasePrice: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  guaranteedConsignorNet: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  minimumAcceptablePrice: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  ownerNotes: z.preprocess(emptyToUndef, z.string().optional()),
});

/** Owner/finance-grade edit of confidential arrangement economics. */
export async function updateArrangementAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "episodes");
  const parsed = arrangementSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  if (d.purchasePrice !== undefined) {
    requireField(user, "acquisition_cost");
    data.purchasePrice = d.purchasePrice;
  }
  if (d.guaranteedConsignorNet !== undefined) {
    requireField(user, "consignor_terms");
    data.guaranteedConsignorNet = d.guaranteedConsignorNet;
  }
  if (d.minimumAcceptablePrice !== undefined) {
    requireField(user, "min_price");
    data.minimumAcceptablePrice = d.minimumAcceptablePrice;
  }
  if (d.ownerNotes !== undefined) {
    requireField(user, "owner_notes");
    data.ownerNotes = d.ownerNotes;
  }
  if (Object.keys(data).length === 0) return;

  await db.arrangement.update({ where: { episodeId: d.episodeId }, data });
  await audit(user, {
    action: "arrangement.update",
    resourceType: "episode",
    resourceId: d.episodeId,
    newValues: Object.keys(data),
  });
  revalidatePath(`/episodes/${d.episodeId}`);
}
