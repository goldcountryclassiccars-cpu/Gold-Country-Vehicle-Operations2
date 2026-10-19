/**
 * Phase 5 media + listing readiness + integration outbox services.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  newStorageKey,
  sha256,
  signUploadToken,
  storage,
  validateUpload,
} from "@/lib/adapters/storage";
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
// Direct-to-storage photo uploads
//
// The browser asks for upload targets (request), PUTs each file straight to
// storage — skipping the app server and its request-size cap — then reports
// back (finalize). Photos are resized in the browser before upload, so each
// photo arrives as up to three files: the original, a web-size copy for the
// gallery, and a thumbnail for grids. The originals are the record — the
// resized copies exist so pages stay fast on a phone.
// ---------------------------------------------------------------------------

export type PhotoVariant = "original" | "web" | "thumb" | "large";
export type MediaPurposeKey = "INTAKE" | "LISTING";
/** Listing photos also get a 2400px JPEG — the copy the platforms receive. */
function variantsFor(purpose: MediaPurposeKey): PhotoVariant[] {
  return purpose === "LISTING" ? ["original", "web", "thumb", "large"] : ["original", "web", "thumb"];
}

/** Most photos one listing can carry — the most any of our platforms takes. */
export const LISTING_PHOTO_LIMIT = 100;

async function listingPhotoCount(episodeId: string) {
  return db.mediaAsset.count({ where: { episodeId, purpose: "LISTING", kind: "PHOTO", archivedAt: null } });
}

function listingFullMessage(current: number) {
  return current >= LISTING_PHOTO_LIMIT
    ? `This listing already has ${LISTING_PHOTO_LIMIT} photos — the most a listing can carry. Remove one to add another.`
    : `Only ${LISTING_PHOTO_LIMIT - current} more photo(s) fit on this listing (limit ${LISTING_PHOTO_LIMIT}).`;
}

export interface PhotoUploadTarget {
  variant: PhotoVariant;
  key: string;
  /** Direct-to-storage URL (null in local dev — use fallbackUrl). */
  putUrl: string | null;
  /** The app's own token-authorized upload route, for dev and small-file fallback. */
  fallbackUrl: string;
}

async function requireActiveEpisode(episodeId: string) {
  const episode = await db.inventoryEpisode.findUnique({ where: { id: episodeId } });
  if (!episode) throw new MediaError("That vehicle record no longer exists.");
  return episode;
}

/** Upload targets for one photo (original + web + thumb). */
export async function requestPhotoUpload(
  user: SessionUser,
  input: { episodeId: string; fileName: string; contentType: string; sizeBytes: number; purpose?: MediaPurposeKey },
): Promise<{ targets: PhotoUploadTarget[] }> {
  await requireActiveEpisode(input.episodeId);
  const purpose = input.purpose ?? "INTAKE";
  if (purpose === "LISTING") {
    const current = await listingPhotoCount(input.episodeId);
    if (current >= LISTING_PHOTO_LIMIT) throw new MediaError(listingFullMessage(current));
  }
  const types = ALLOWED_UPLOAD_TYPES.image!;
  if (!types.includes(input.contentType)) {
    throw new MediaError("That file is not a photo the app can accept (JPEG, PNG, WEBP or HEIC).");
  }
  const max = MAX_UPLOAD_BYTES.image!;
  if (input.sizeBytes <= 0 || input.sizeBytes > max) {
    throw new MediaError(`Photos can be up to ${Math.round(max / 1024 / 1024)}MB each.`);
  }

  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  const targets: PhotoUploadTarget[] = [];
  for (const variant of variantsFor(purpose)) {
    // Resized variants are always JPEG (the browser re-encodes them).
    const contentType = variant === "original" ? input.contentType : "image/jpeg";
    const name = variant === "original" ? input.fileName : `${variant}.jpg`;
    const key = newStorageKey(`media/${input.episodeId}/${variant}`, name);
    const token = signUploadToken({ key, contentType, userId: user.id, maxBytes: max, exp });
    targets.push({
      variant,
      key,
      putUrl: await storage().presignPut(key, contentType),
      fallbackUrl: `/api/media/direct-upload?token=${encodeURIComponent(token)}`,
    });
  }
  return { targets };
}

/**
 * Registers an uploaded photo on the vehicle. Keys must be ones this app
 * issued for this episode (prefix-checked) and must actually exist in storage
 * — the client's word alone is never enough.
 */
export async function finalizePhotoUpload(
  user: SessionUser,
  input: {
    episodeId: string;
    originalName: string;
    contentType: string;
    originalKey: string;
    webKey?: string | null;
    thumbKey?: string | null;
    largeKey?: string | null;
    category?: string | null;
    caption?: string | null;
    purpose?: MediaPurposeKey;
  },
) {
  await requireActiveEpisode(input.episodeId);
  const purpose = input.purpose ?? "INTAKE";
  if (purpose === "LISTING") {
    // Checked again here, not only at request time: ten photos requested in
    // parallel at 95 would otherwise all pass the first check.
    const current = await listingPhotoCount(input.episodeId);
    if (current >= LISTING_PHOTO_LIMIT) {
      const keys = [input.originalKey, input.webKey, input.thumbKey, input.largeKey].filter(Boolean) as string[];
      await Promise.all(
        keys.filter((k) => k.startsWith(`media/${input.episodeId}/`)).map((k) => storage().delete(k).catch(() => {})),
      );
      throw new MediaError(listingFullMessage(current));
    }
  }

  const makeFile = async (key: string | null | undefined, variant: PhotoVariant) => {
    if (!key) return null;
    if (!key.startsWith(`media/${input.episodeId}/${variant}/`)) {
      throw new MediaError("Upload did not match this vehicle — please try again.");
    }
    const found = await storage().head(key);
    if (!found) throw new MediaError("The upload did not finish — please try again.");
    validateUpload("image", variant === "original" ? input.contentType : "image/jpeg", found.sizeBytes);
    return db.fileObject.create({
      data: {
        storageKey: key,
        adapter: config().STORAGE_ADAPTER,
        originalName: variant === "original" ? input.originalName : `${variant} of ${input.originalName}`,
        contentType: variant === "original" ? input.contentType : "image/jpeg",
        sizeBytes: found.sizeBytes,
        uploadedBy: user.id,
      },
    });
  };

  const original = await makeFile(input.originalKey, "original");
  if (!original) throw new MediaError("The upload did not finish — please try again.");
  const web = await makeFile(input.webKey, "web");
  const thumb = await makeFile(input.thumbKey, "thumb");
  const large = purpose === "LISTING" ? await makeFile(input.largeKey, "large") : null;

  const maxSort = await db.mediaAsset.aggregate({
    where: { episodeId: input.episodeId, purpose },
    _max: { sortOrder: true },
  });
  const asset = await db.mediaAsset.create({
    data: {
      episodeId: input.episodeId,
      fileId: original.id,
      webFileId: web?.id ?? null,
      thumbFileId: thumb?.id ?? null,
      largeFileId: large?.id ?? null,
      kind: "PHOTO",
      purpose,
      category: input.category?.trim() || (purpose === "LISTING" ? "listing" : "other"),
      caption: input.caption?.trim() || null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      uploadedById: user.id,
    },
  });
  await audit(user, {
    action: "media.upload",
    resourceType: "media",
    resourceId: asset.id,
    newValues: {
      episodeId: input.episodeId,
      name: input.originalName,
      sizeBytes: original.sizeBytes,
      resized: Boolean(web || thumb),
      purpose,
    },
  });
  if (purpose === "LISTING") await bumpListingVersion(input.episodeId);
  return asset;
}

/** A listing's buyer-visible content changed — channels holding an older copy need the update. */
export async function bumpListingVersion(episodeId: string) {
  await db.listing.updateMany({ where: { episodeId }, data: { contentVersion: { increment: 1 } } });
}

// ---------------------------------------------------------------------------
// Listing video files. Straight to storage only — a walkaround video is far
// past what the app server can relay — and kept as the original file.
// ---------------------------------------------------------------------------

export async function requestVideoUpload(
  user: SessionUser,
  input: { episodeId: string; fileName: string; contentType: string; sizeBytes: number },
): Promise<{ key: string; putUrl: string | null; fallbackUrl: string }> {
  await requireActiveEpisode(input.episodeId);
  const types = ALLOWED_UPLOAD_TYPES.video!;
  if (!types.includes(input.contentType)) {
    throw new MediaError("Videos need to be MP4 or MOV files (what a phone records).");
  }
  const max = MAX_UPLOAD_BYTES.video!;
  if (input.sizeBytes <= 0 || input.sizeBytes > max) {
    throw new MediaError(
      `Videos can be up to ${Math.round(max / 1024 / 1024)}MB — for anything longer, upload it to YouTube and add the link instead.`,
    );
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const key = newStorageKey(`media/${input.episodeId}/video`, input.fileName);
  const token = signUploadToken({ key, contentType: input.contentType, userId: user.id, maxBytes: max, exp });
  return {
    key,
    putUrl: await storage().presignPut(key, input.contentType),
    fallbackUrl: `/api/media/direct-upload?token=${encodeURIComponent(token)}`,
  };
}

export async function finalizeVideoUpload(
  user: SessionUser,
  input: { episodeId: string; originalName: string; contentType: string; key: string; caption?: string | null },
) {
  await requireActiveEpisode(input.episodeId);
  if (!input.key.startsWith(`media/${input.episodeId}/video/`)) {
    throw new MediaError("Upload did not match this vehicle — please try again.");
  }
  const found = await storage().head(input.key);
  if (!found) throw new MediaError("The video upload did not finish — please try again.");
  validateUpload("video", input.contentType, found.sizeBytes);
  const file = await db.fileObject.create({
    data: {
      storageKey: input.key,
      adapter: config().STORAGE_ADAPTER,
      originalName: input.originalName,
      contentType: input.contentType,
      sizeBytes: found.sizeBytes,
      uploadedBy: user.id,
    },
  });
  const maxSort = await db.mediaAsset.aggregate({
    where: { episodeId: input.episodeId, purpose: "LISTING", kind: "VIDEO" },
    _max: { sortOrder: true },
  });
  const asset = await db.mediaAsset.create({
    data: {
      episodeId: input.episodeId,
      fileId: file.id,
      kind: "VIDEO",
      purpose: "LISTING",
      category: "listing_video",
      caption: input.caption?.trim() || null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      uploadedById: user.id,
    },
  });
  await audit(user, {
    action: "media.video_upload",
    resourceType: "media",
    resourceId: asset.id,
    newValues: { episodeId: input.episodeId, name: input.originalName, sizeBytes: found.sizeBytes },
  });
  await bumpListingVersion(input.episodeId);
  return asset;
}

// ---------------------------------------------------------------------------
// Video links (the videos themselves stay on Google Photos / YouTube)
// ---------------------------------------------------------------------------

export async function addVideoLink(
  user: SessionUser,
  input: { episodeId: string; url: string; label?: string | null; purpose?: MediaPurposeKey },
) {
  await requireActiveEpisode(input.episodeId);
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new MediaError("That does not look like a link — paste the full https:// address.");
  }
  if (parsed.protocol !== "https:") throw new MediaError("Video links must start with https://");
  const link = await db.videoLink.create({
    data: {
      episodeId: input.episodeId,
      url: parsed.toString(),
      label: input.label?.trim() || null,
      purpose: input.purpose ?? "INTAKE",
      createdById: user.id,
    },
  });
  if (link.purpose === "LISTING") await bumpListingVersion(input.episodeId);
  await audit(user, {
    action: "media.video_link_add",
    resourceType: "media",
    resourceId: link.id,
    newValues: { episodeId: input.episodeId, host: parsed.host, label: link.label },
  });
  return link;
}

export async function removeVideoLink(user: SessionUser, id: string) {
  const link = await db.videoLink.findUnique({ where: { id } });
  if (!link) return; // already gone — the desired state
  await db.videoLink.delete({ where: { id } });
  if (link.purpose === "LISTING") await bumpListingVersion(link.episodeId);
  await audit(user, {
    action: "media.video_link_remove",
    resourceType: "media",
    resourceId: id,
    previousValues: { episodeId: link.episodeId, url: link.url },
  });
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
    db.mediaAsset.groupBy({ by: ["category"], where: { episodeId, purpose: "INTAKE", archivedAt: null }, _count: true }),
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
