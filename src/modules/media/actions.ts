"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { submitToListingSystem, MediaError } from "./service";

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
}
