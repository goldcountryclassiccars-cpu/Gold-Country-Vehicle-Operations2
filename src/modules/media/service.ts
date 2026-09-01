/**
 * Phase 5 media + listing readiness + integration outbox services.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { storage, newStorageKey, sha256, validateUpload } from "@/lib/adapters/storage";
import { config } from "@/lib/config";
import type { SessionUser } from "@/lib/authz/types";

export class MediaError extends Error {}

// ---------------------------------------------------------------------------
// Files + media assets
// ---------------------------------------------------------------------------

export async function uploadMediaAsset(
  user: SessionUser,
  input: {
    episodeId: string;
    kind: "PHOTO" | "VIDEO" | "DOCUMENT";
    category: string;
    caption?: string | null;
    originalName: string;
    contentType: string;
    data: Buffer;
  },
) {
  const uploadKind = input.kind === "PHOTO" ? "image" : input.kind === "VIDEO" ? "video" : "document";
  validateUpload(uploadKind, input.contentType, input.data.length);
  const storageKey = newStorageKey(`media/${input.episodeId}`, input.originalName);
  await storage().put(storageKey, input.data);
  const file = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: input.originalName,
      contentType: input.contentType,
      sizeBytes: input.data.length,
      sha256: sha256(input.data),
      uploadedBy: user.id,
    },
  });
  const maxSort = await db.mediaAsset.aggregate({ where: { episodeId: input.episodeId }, _max: { sortOrder: true } });
  const asset = await db.mediaAsset.create({
    data: {
      episodeId: input.episodeId,
      fileId: file.id,
      kind: input.kind,
      category: input.category,
      caption: input.caption ?? null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      uploadedById: user.id,
    },
  });
  await audit(user, {
    action: "media.upload",
    resourceType: "media",
    resourceId: asset.id,
    newValues: { episodeId: input.episodeId, category: input.category, name: input.originalName },
  });
  return asset;
}

// ---------------------------------------------------------------------------
// Media checklist / readiness (computed)
// ---------------------------------------------------------------------------

export interface MediaReadiness {
  items: { key: string; name: string; required: boolean; count: number; satisfied: boolean }[];
  requiredSatisfied: number;
  requiredTotal: number;
  complete: boolean;
}

export async function mediaReadiness(episodeId: string): Promise<MediaReadiness> {
  const [checklist, assets] = await Promise.all([
    db.mediaChecklistItem.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.mediaAsset.groupBy({ by: ["category"], where: { episodeId, archivedAt: null }, _count: true }),
  ]);
  const countByCategory = new Map(assets.map((a) => [a.category, a._count]));
  const items = checklist.map((c) => {
    const count = countByCategory.get(c.key) ?? 0;
    return { key: c.key, name: c.name, required: c.required, count, satisfied: count > 0 };
  });
  const required = items.filter((i) => i.required);
  const requiredSatisfied = required.filter((i) => i.satisfied).length;
  return {
    items,
    requiredSatisfied,
    requiredTotal: required.length,
    complete: required.length > 0 && requiredSatisfied === required.length,
  };
}

// ---------------------------------------------------------------------------
// Listing readiness (computed across modules)
// ---------------------------------------------------------------------------

export interface ListingReadiness {
  checks: { key: string; label: string; ok: boolean; detail?: string }[];
  ready: boolean;
}

export async function listingReadiness(episodeId: string): Promise<ListingReadiness> {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { vehicle: { include: { identifiers: true } }, intake: true },
  });
  const media = await mediaReadiness(episodeId);
  // A safety finding is "unaddressed" until a work order exists for it.
  const openSafetyUnresolved = await db.inspectionFinding.count({
    where: { inspection: { episodeId }, severity: "SAFETY", workOrderId: null },
  });

  const v = episode.vehicle;
  const specsOk = Boolean(v.make && v.model && v.year && v.exteriorColor && v.engineDescription);
  const checks = [
    { key: "specs", label: "Core specifications complete", ok: specsOk, detail: specsOk ? undefined : "Year, colors, engine required" },
    { key: "identifier", label: "Primary identifier recorded", ok: v.identifiers.some((i) => i.isPrimary) },
    { key: "intake", label: "Intake completed", ok: episode.intake?.status === "complete" },
    {
      key: "recon",
      label: "Reconditioning resolved",
      ok: ["COMPLETE", "NO_WORK_REQUIRED", "WORK_DECLINED"].includes(episode.reconditioningStatus),
    },
    { key: "safety", label: "No unaddressed safety findings", ok: openSafetyUnresolved === 0 },
    { key: "media", label: `Required media (${media.requiredSatisfied}/${media.requiredTotal})`, ok: media.complete },
    { key: "price", label: "Asking price set", ok: episode.askingPrice != null },
  ];
  return { checks, ready: checks.every((c) => c.ok) };
}

// ---------------------------------------------------------------------------
// Integration outbox
// ---------------------------------------------------------------------------

export async function emitIntegrationEvent(
  type: string,
  episodeId: string | null,
  payload: Record<string, unknown>,
) {
  // Idempotency: one event per (type, episode, payload hash).
  const idempotencyKey = createHash("sha256")
    .update(`${type}:${episodeId ?? ""}:${JSON.stringify(payload)}`)
    .digest("hex");
  return db.integrationEvent.upsert({
    where: { idempotencyKey },
    update: {}, // duplicate emit is a no-op
    create: { type, episodeId, payload: JSON.parse(JSON.stringify(payload)), idempotencyKey },
  });
}

/** Marks an episode as submitted to the listing system, emitting the outbox event. */
export async function submitToListingSystem(user: SessionUser, episodeId: string) {
  const readiness = await listingReadiness(episodeId);
  if (!readiness.ready) throw new MediaError("Listing package is not complete");
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { vehicle: { include: { identifiers: { where: { isPrimary: true } } } } },
  });
  const { changeEpisodeStatus } = await import("@/modules/episodes/service");
  await changeEpisodeStatus(user, episodeId, "marketing", "SUBMITTED_TO_LISTING_SYSTEM", "Listing package submitted");
  const event = await emitIntegrationEvent("vehicle.listing_ready", episodeId, {
    episodeId,
    vehicleId: episode.vehicleId,
    stockNumber: episode.stockNumber,
    askingPrice: episode.askingPrice ? Number(episode.askingPrice) : null,
    vehicle: {
      year: episode.vehicle.year,
      make: episode.vehicle.make,
      model: episode.vehicle.model,
      trim: episode.vehicle.trim,
      primaryIdentifier: episode.vehicle.identifiers[0]?.value ?? null,
    },
  });
  await audit(user, {
    action: "listing.submit",
    resourceType: "episode",
    resourceId: episodeId,
    newValues: { eventId: event.id },
  });
  return event;
}
