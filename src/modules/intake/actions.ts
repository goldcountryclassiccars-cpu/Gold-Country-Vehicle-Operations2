"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MileageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { changeEpisodeStatus } from "@/modules/episodes/service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const intakeSchema = z.object({
  episodeId: z.string().uuid(),
  mode: z.enum(["draft", "complete"]),
  arrivalMethod: z.preprocess(emptyToUndef, z.enum(["carrier", "driven", "towed", "other"]).optional()),
  odometerReading: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).optional()),
  mileageStatus: z.preprocess(emptyToUndef, z.nativeEnum(MileageStatus).optional()),
  identityVerified: checkbox,
  starts: checkbox,
  runs: checkbox,
  drives: checkbox,
  stops: checkbox,
  fuelLevel: z.preprocess(emptyToUndef, z.string().optional()),
  exteriorDamageNotes: z.preprocess(emptyToUndef, z.string().optional()),
  interiorDamageNotes: z.preprocess(emptyToUndef, z.string().optional()),
  tireCondition: z.preprocess(emptyToUndef, z.string().optional()),
  transportDamageNotes: z.preprocess(emptyToUndef, z.string().optional()),
  sellerReportedIssues: z.preprocess(emptyToUndef, z.string().optional()),
  keysReceived: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).optional()),
  documentsReceived: z.preprocess(emptyToUndef, z.string().optional()),
  accessoriesReceived: z.preprocess(emptyToUndef, z.string().optional()),
  safetyConcerns: z.preprocess(emptyToUndef, z.string().optional()),
  initialLocationId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  notes: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function saveIntakeAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "intake");
  const parsed = intakeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { episodeId, mode, ...fields } = parsed.data;
  const completing = mode === "complete";

  await db.intakeRecord.upsert({
    where: { episodeId },
    update: {
      ...fields,
      status: completing ? "complete" : "draft",
      completedAt: completing ? new Date() : null,
      receivedAt: completing ? new Date() : undefined,
      receivedById: user.id,
    },
    create: {
      episodeId,
      ...fields,
      status: completing ? "complete" : "draft",
      completedAt: completing ? new Date() : null,
      receivedAt: completing ? new Date() : undefined,
      receivedById: user.id,
    },
  });

  if (completing) {
    // Arrival: custody moves to ON_SITE (records history + timestamps).
    await changeEpisodeStatus(user, episodeId, "custody", "ON_SITE", "Intake completed");
    if (fields.initialLocationId) {
      await db.inventoryEpisode.update({ where: { id: episodeId }, data: { currentLocationId: fields.initialLocationId } });
      await db.vehicleLocationEvent.create({
        data: { episodeId, toLocationId: fields.initialLocationId, movedById: user.id, reason: "Intake" },
      });
    }
  }

  await audit(user, {
    action: completing ? "intake.complete" : "intake.save_draft",
    resourceType: "episode",
    resourceId: episodeId,
  });

  revalidatePath(`/episodes/${episodeId}`);
  if (completing) redirect(`/episodes/${episodeId}`);
}
