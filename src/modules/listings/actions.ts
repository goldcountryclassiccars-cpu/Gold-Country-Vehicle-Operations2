"use server";

/**
 * Listing Tool actions. Every one returns its refusal as a visible message —
 * none of them fail silently (the v18/v19 lesson).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import {
  finalizePhotoUpload,
  finalizeVideoUpload,
  MediaError,
  addVideoLink,
  removeVideoLink,
  requestPhotoUpload,
  requestVideoUpload,
  type PhotoUploadTarget,
} from "@/modules/media/service";
import {
  copyIntakePhotosToListing,
  ListingError,
  markPublicationLive,
  publishListing,
  removeListingMedia,
  reorderListingPhotos,
  saveListing,
  setCoverPhoto,
  startListing,
  unpublishListing,
  updateChannel,
} from "./service";

export interface ListingFormState {
  error?: string;
  notice?: string;
  saved?: number;
}

function refresh(episodeId: string) {
  revalidatePath(`/listings/${episodeId}`);
  revalidatePath(`/listings/${episodeId}/kit`);
  revalidatePath("/listings");
  revalidatePath(`/episodes/${episodeId}`);
}

function failure(e: unknown): string {
  if (e instanceof ListingError || e instanceof MediaError) return e.message;
  throw e;
}

// ---------------------------------------------------------------------------
// Write-up
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().max(max, `Keep this under ${max.toLocaleString()} characters.`).optional();

const writeupSchema = z.object({
  episodeId: z.string().uuid(),
  title: z.string().max(200),
  headline: optionalText(300),
  highlights: optionalText(4000),
  description: optionalText(20000),
  equipment: optionalText(10000),
  history: optionalText(20000),
  condition: optionalText(10000),
  documentation: optionalText(10000),
  priceDisplay: z.enum(["SHOW", "CALL_FOR_PRICE"]).optional(),
  askingPrice: z.string().max(30).optional(),
});

export async function saveListingAction(prev: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const user = await getSessionUser();
  requirePermission(user, "edit", "listings");
  const parsed = writeupSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  let askingPrice: number | null | undefined;
  if (d.askingPrice !== undefined && d.askingPrice.trim() !== "") {
    askingPrice = Number(d.askingPrice.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(askingPrice)) return { error: "Enter the asking price as a number, like 79900." };
  }
  try {
    const { changed } = await saveListing(user, d.episodeId, {
      title: d.title,
      headline: d.headline,
      highlights: d.highlights?.split("\n"),
      description: d.description,
      equipment: d.equipment,
      history: d.history,
      condition: d.condition,
      documentation: d.documentation,
      priceDisplay: d.priceDisplay,
      askingPrice,
    });
    refresh(d.episodeId);
    return { saved: (prev.saved ?? 0) + 1, notice: changed.length ? "Saved." : "No changes to save." };
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function startListingAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const episodeId = String(formData.get("episodeId") ?? "");
  if (!z.string().uuid().safeParse(episodeId).success) return;
  await startListing(user, episodeId);
  refresh(episodeId);
}

// ---------------------------------------------------------------------------
// Photos — the uploader calls these imperatively, so they return values
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  episodeId: z.string().uuid(),
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function requestListingPhotoUploadAction(
  input: z.infer<typeof requestSchema>,
): Promise<{ targets?: PhotoUploadTarget[]; error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not read that file's details." };
  try {
    await startListing(user, parsed.data.episodeId);
    return await requestPhotoUpload(user, { ...parsed.data, purpose: "LISTING" });
  } catch (e) {
    return { error: failure(e) };
  }
}

const finalizeSchema = z.object({
  episodeId: z.string().uuid(),
  originalName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(100),
  originalKey: z.string().min(1),
  webKey: z.string().min(1).nullish(),
  thumbKey: z.string().min(1).nullish(),
  largeKey: z.string().min(1).nullish(),
});

export async function finalizeListingPhotoUploadAction(
  input: z.infer<typeof finalizeSchema>,
): Promise<{ assetId?: string; error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not read the upload result." };
  try {
    const asset = await finalizePhotoUpload(user, { ...parsed.data, purpose: "LISTING" });
    return { assetId: asset.id };
  } catch (e) {
    return { error: failure(e) };
  }
}

/** Called once after a batch finishes, so 100 uploads are not 100 page refreshes. */
export async function refreshListingAction(episodeId: string) {
  const user = await getSessionUser();
  requirePermission(user, "view", "listings");
  if (z.string().uuid().safeParse(episodeId).success) refresh(episodeId);
}

export async function reorderListingPhotosAction(input: {
  episodeId: string;
  orderedIds: string[];
}): Promise<{ error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "edit", "listings");
  const parsed = z.object({ episodeId: z.string().uuid(), orderedIds: z.array(z.string().uuid()).max(200) }).safeParse(input);
  if (!parsed.success) return { error: "Could not read the new order." };
  try {
    await reorderListingPhotos(user, parsed.data.episodeId, parsed.data.orderedIds);
    refresh(parsed.data.episodeId);
    return {};
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function setCoverPhotoAction(input: { episodeId: string; assetId: string }): Promise<{ error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "edit", "listings");
  const parsed = z.object({ episodeId: z.string().uuid(), assetId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Could not read that photo." };
  try {
    await setCoverPhoto(user, parsed.data.episodeId, parsed.data.assetId);
    refresh(parsed.data.episodeId);
    return {};
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function removeListingMediaAction(input: { episodeId: string; assetId: string }): Promise<{ error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "edit", "listings");
  const parsed = z.object({ episodeId: z.string().uuid(), assetId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Could not read that item." };
  try {
    await removeListingMedia(user, parsed.data.assetId);
    refresh(parsed.data.episodeId);
    return {};
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function copyIntakePhotosAction(prev: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const episodeId = String(formData.get("episodeId") ?? "");
  const ids = formData.getAll("assetId").map(String);
  if (!z.string().uuid().safeParse(episodeId).success) return { error: "Could not read the vehicle." };
  try {
    await startListing(user, episodeId);
    const { added, skipped } = await copyIntakePhotosToListing(user, episodeId, ids);
    refresh(episodeId);
    return {
      saved: (prev.saved ?? 0) + 1,
      notice: `Added ${added} photo${added === 1 ? "" : "s"} to the listing${skipped ? ` — ${skipped} left out (100-photo limit)` : ""}.`,
    };
  } catch (e) {
    return { error: failure(e) };
  }
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export async function requestListingVideoUploadAction(
  input: z.infer<typeof requestSchema>,
): Promise<{ key?: string; putUrl?: string | null; fallbackUrl?: string; error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not read that file's details." };
  try {
    await startListing(user, parsed.data.episodeId);
    return await requestVideoUpload(user, parsed.data);
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function finalizeListingVideoUploadAction(input: {
  episodeId: string;
  originalName: string;
  contentType: string;
  key: string;
}): Promise<{ assetId?: string; error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const parsed = z
    .object({ episodeId: z.string().uuid(), originalName: z.string().min(1).max(300), contentType: z.string().min(1).max(100), key: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { error: "Could not read the upload result." };
  try {
    const asset = await finalizeVideoUpload(user, parsed.data);
    refresh(parsed.data.episodeId);
    return { assetId: asset.id };
  } catch (e) {
    return { error: failure(e) };
  }
}

const videoLinkSchema = z.object({
  episodeId: z.string().uuid(),
  url: z.string().min(1, "Paste the video's link."),
  label: z.string().max(200).optional(),
});

export async function addListingVideoLinkAction(prev: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "listings");
  const parsed = videoLinkSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the link and try again." };
  try {
    await startListing(user, parsed.data.episodeId);
    await addVideoLink(user, { ...parsed.data, purpose: "LISTING" });
    refresh(parsed.data.episodeId);
    return { saved: (prev.saved ?? 0) + 1 };
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function removeListingVideoLinkAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "listings");
  const id = String(formData.get("id") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");
  if (!id) return;
  await removeVideoLink(user, id);
  if (episodeId) refresh(episodeId);
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export async function publishListingAction(prev: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const user = await getSessionUser();
  requirePermission(user, "generate", "listings");
  const episodeId = String(formData.get("episodeId") ?? "");
  const channels = formData.getAll("channel").map(String);
  if (!z.string().uuid().safeParse(episodeId).success) return { error: "Could not read the vehicle." };
  try {
    await publishListing(user, episodeId, channels);
    refresh(episodeId);
    return { saved: (prev.saved ?? 0) + 1, notice: "Published — each place picks it up on its next check." };
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function unpublishListingAction(prev: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const user = await getSessionUser();
  requirePermission(user, "generate", "listings");
  const episodeId = String(formData.get("episodeId") ?? "");
  const channel = String(formData.get("channel") ?? "");
  if (!z.string().uuid().safeParse(episodeId).success) return { error: "Could not read the vehicle." };
  try {
    await unpublishListing(user, episodeId, channel);
    refresh(episodeId);
    return { saved: (prev.saved ?? 0) + 1, notice: "Taken down." };
  } catch (e) {
    return { error: failure(e) };
  }
}

export async function markLiveAction(prev: ListingFormState, formData: FormData): Promise<ListingFormState> {
  const user = await getSessionUser();
  requirePermission(user, "generate", "listings");
  const episodeId = String(formData.get("episodeId") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!z.string().uuid().safeParse(episodeId).success) return { error: "Could not read the vehicle." };
  try {
    await markPublicationLive(user, episodeId, channel, url);
    refresh(episodeId);
    return { saved: (prev.saved ?? 0) + 1, notice: "Marked live." };
  } catch (e) {
    return { error: failure(e) };
  }
}

// ---------------------------------------------------------------------------
// Channel settings (Admin)
// ---------------------------------------------------------------------------

export async function updateChannelAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "listings");
  const key = String(formData.get("key") ?? "");
  const method = formData.get("method");
  const enabled = formData.get("enabled");
  const rotate = formData.get("rotate") === "1";
  await updateChannel(user, key, {
    method: method === "FEED" || method === "MANUAL" ? method : undefined,
    enabled: enabled === "1" ? true : enabled === "0" ? false : undefined,
    rotateToken: rotate,
  });
  revalidatePath("/listings/channels");
}
