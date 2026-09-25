"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  addVideoLink,
  finalizePhotoUpload,
  MediaError,
  removeVideoLink,
  requestPhotoUpload,
  submitToListingSystem,
  type PhotoUploadTarget,
} from "./service";

const submitSchema = z.object({ episodeId: z.string().uuid() });

export async function submitToListingAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "generate", "listings");
  const parsed = submitSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await submitToListingSystem(user, parsed.data.episodeId);
  } catch (e) {
    if (e instanceof MediaError) return;
    throw e;
  }
  revalidatePath("/listings");
  revalidatePath("/integrations");
  revalidatePath(`/episodes/${parsed.data.episodeId}`);
}

// ---------------------------------------------------------------------------
// Direct-to-storage photo uploads. These two are called imperatively from the
// uploader component (not through a <form>), so they return their result and
// errors as values — the component shows every failure next to the file.
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  episodeId: z.string().uuid(),
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function requestPhotoUploadAction(
  input: z.infer<typeof requestSchema>,
): Promise<{ targets?: PhotoUploadTarget[]; error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "create", "media");
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not read that file's details." };
  try {
    return await requestPhotoUpload(user, parsed.data);
  } catch (e) {
    if (e instanceof MediaError) return { error: e.message };
    throw e;
  }
}

const finalizeSchema = z.object({
  episodeId: z.string().uuid(),
  originalName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(100),
  originalKey: z.string().min(1),
  webKey: z.string().min(1).nullish(),
  thumbKey: z.string().min(1).nullish(),
  category: z.string().max(100).nullish(),
});

export async function finalizePhotoUploadAction(
  input: z.infer<typeof finalizeSchema>,
): Promise<{ assetId?: string; error?: string }> {
  const user = await getSessionUser();
  requirePermission(user, "create", "media");
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not read the upload result." };
  try {
    const asset = await finalizePhotoUpload(user, parsed.data);
    revalidatePath("/media");
    revalidatePath(`/episodes/${parsed.data.episodeId}`);
    return { assetId: asset.id };
  } catch (e) {
    if (e instanceof MediaError) return { error: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Video links + photo removal (form actions with visible errors)
// ---------------------------------------------------------------------------

export interface MediaFormState {
  error?: string;
  saved?: number;
}

const videoLinkSchema = z.object({
  episodeId: z.string().uuid(),
  url: z.string().min(1, "Paste the video's link."),
  label: z.string().max(200).optional(),
});

export async function addVideoLinkAction(
  prev: MediaFormState,
  formData: FormData,
): Promise<MediaFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "media");
  const parsed = videoLinkSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the link and try again." };
  try {
    await addVideoLink(user, parsed.data);
  } catch (e) {
    if (e instanceof MediaError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/episodes/${parsed.data.episodeId}`);
  return { saved: (prev.saved ?? 0) + 1 };
}

export async function removeVideoLinkAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "media");
  const id = formData.get("id");
  const episodeId = formData.get("episodeId");
  if (typeof id !== "string") return;
  await removeVideoLink(user, id);
  if (typeof episodeId === "string") revalidatePath(`/episodes/${episodeId}`);
}

const archiveSchema = z.object({ assetId: z.string().uuid() });

export async function archiveMediaAssetAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "media");
  const parsed = archiveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const asset = await db.mediaAsset.update({
    where: { id: parsed.data.assetId },
    data: { archivedAt: new Date() },
  });
  await audit(user, { action: "media.archive", resourceType: "media", resourceId: asset.id });
  revalidatePath("/media");
  revalidatePath(`/episodes/${asset.episodeId}`);
  const episode = await db.inventoryEpisode.findUnique({ where: { id: asset.episodeId }, select: { vehicleId: true } });
  if (episode) revalidatePath(`/vehicles/${episode.vehicleId}`);
}
