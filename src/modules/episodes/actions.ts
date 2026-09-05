"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission, requireField } from "@/lib/authz/engine";
import {
  archiveEpisode,
  changeEpisodeStatus,
  restoreEpisode,
  setAskingPrice,
  STATUS_DIMENSIONS,
  StatusError,
  type StatusDimension,
} from "./service";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextMove, writesToReach, type BoardStage, type StatusWrite } from "./board";

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
  // Title and lien state are not confidential economics — they are the facts
  // the sale-document rules read (REG 227, REG 31, REG 262, lien release), and
  // until now nothing in the app could set them at all.
  titleStatus: z.preprocess(emptyToUndef, z.enum(["present", "missing", "lien", "pending"]).optional()),
  titleState: z.preprocess(emptyToUndef, z.string().trim().length(2).toUpperCase().optional()),
  lienStatus: z.preprocess(emptyToUndef, z.enum(["none", "lien", "open", "active", "released"]).optional()),
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
  if (d.titleStatus !== undefined) data.titleStatus = d.titleStatus;
  if (d.titleState !== undefined) data.titleState = d.titleState;
  if (d.lienStatus !== undefined) data.lienStatus = d.lienStatus;
  if (Object.keys(data).length === 0) return;

  await db.arrangement.update({ where: { episodeId: d.episodeId }, data });
  await audit(user, {
    action: "arrangement.update",
    resourceType: "episode",
    resourceId: d.episodeId,
    newValues: Object.keys(data),
  });
  // Title and lien facts change what paperwork an open deal needs.
  const { reevaluateEpisodeSales } = await import("@/modules/documents/requirements");
  await reevaluateEpisodeSales(user, d.episodeId);
  revalidatePath(`/episodes/${d.episodeId}`);
}

const archiveSchema = z.object({
  episodeId: z.string().uuid(),
  reason: z.string().trim().min(1),
});

/**
 * Archiving removes a car from every active list, so it is gated on the
 * `archive` permission rather than plain `edit` — under the three-role model
 * that means Admin only. Restoring is gated the same way.
 */
export async function archiveEpisodeAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "archive", "episodes");
  const parsed = archiveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await archiveEpisode(user, parsed.data.episodeId, parsed.data.reason);
  revalidatePath(`/episodes/${parsed.data.episodeId}`);
  revalidatePath("/vehicles");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

export async function restoreEpisodeAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "archive", "episodes");
  const parsed = archiveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await restoreEpisode(user, parsed.data.episodeId, parsed.data.reason);
  revalidatePath(`/episodes/${parsed.data.episodeId}`);
  revalidatePath("/vehicles");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

/**
 * The Pipeline's forward button, and its "move it somewhere else" picker.
 *
 * Both resolve the writes SERVER-SIDE from the episode's current state rather
 * than trusting a list of status changes posted by the browser. The board is a
 * simplification for the operator, not a new way to set arbitrary statuses: a
 * form that posted its own writes would be a second, unvalidated path into the
 * same fields the six dropdowns already guard.
 */
const stageSchema = z.object({
  episodeId: z.string().uuid(),
  /** Present for the picker; absent means "one step forward". */
  to: z.string().optional(),
});

export async function moveStageAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "episodes");
  const parsed = stageSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { episodeId, to } = parsed.data;

  const episode = await db.inventoryEpisode.findUnique({ where: { id: episodeId } });
  if (!episode) return;

  let writes: StatusWrite[] | null;
  let reason: string;
  if (to) {
    writes = writesToReach(episode, to as BoardStage);
    reason = `Moved to ${to} on the Pipeline`;
  } else {
    const move = nextMove(episode, episodeId);
    writes = move && move.kind === "advance" ? move.writes : null;
    reason = move ? `Moved to ${move.to} on the Pipeline` : "";
  }
  if (!writes) return; // Stale button: the car moved under them. The page re-renders as it is.

  for (const w of writes) {
    await changeEpisodeStatus(user, episodeId, w.dimension, w.value, reason);
  }
  revalidatePath(`/episodes/${episodeId}`);
  revalidatePath("/pipeline");
  revalidatePath("/vehicles");
  revalidatePath("/dashboard");
}
