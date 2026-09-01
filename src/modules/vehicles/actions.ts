"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { IdentifierType, MileageStatus, DealType } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission, canViewField } from "@/lib/authz/engine";
import { createVehicle, addIdentifier } from "./service";
import { createEpisode } from "@/modules/episodes/service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const newVehicleSchema = z.object({
  year: z.preprocess(emptyToUndef, z.coerce.number().int().min(1885).max(2100).optional()),
  make: z.string().trim().min(1, "Make is required"),
  model: z.string().trim().min(1, "Model is required"),
  trim: z.preprocess(emptyToUndef, z.string().optional()),
  bodyStyle: z.preprocess(emptyToUndef, z.string().optional()),
  exteriorColor: z.preprocess(emptyToUndef, z.string().optional()),
  interiorColor: z.preprocess(emptyToUndef, z.string().optional()),
  engineDescription: z.preprocess(emptyToUndef, z.string().optional()),
  transmission: z.preprocess(emptyToUndef, z.string().optional()),
  mileage: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).optional()),
  mileageStatus: z.nativeEnum(MileageStatus).default("UNKNOWN"),
  generalDescription: z.preprocess(emptyToUndef, z.string().optional()),
  identifierType: z.nativeEnum(IdentifierType).default("UNKNOWN_PENDING"),
  identifierValue: z.preprocess(emptyToUndef, z.string().optional()),
  // Episode
  dealType: z.nativeEnum(DealType),
  acquisitionSourceId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  expectedArrivalAt: z.preprocess(emptyToUndef, z.coerce.date().optional()),
  askingPrice: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  // Confidential (ignored unless the user holds the matching grants)
  purchasePrice: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  minimumAcceptablePrice: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  ownerNotes: z.preprocess(emptyToUndef, z.string().optional()),
});

export interface NewVehicleState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createVehicleAction(_prev: NewVehicleState, formData: FormData): Promise<NewVehicleState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "vehicles");
  requirePermission(user, "create", "episodes");

  const parsed = newVehicleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Fix the highlighted fields.", fieldErrors };
  }
  const d = parsed.data;

  const vehicle = await createVehicle(user, {
    year: d.year ?? null,
    make: d.make,
    model: d.model,
    trim: d.trim ?? null,
    bodyStyle: d.bodyStyle ?? null,
    exteriorColor: d.exteriorColor ?? null,
    interiorColor: d.interiorColor ?? null,
    engineDescription: d.engineDescription ?? null,
    transmission: d.transmission ?? null,
    mileage: d.mileage ?? null,
    mileageStatus: d.mileageStatus,
    generalDescription: d.generalDescription ?? null,
    identifier: d.identifierValue ? { type: d.identifierType, value: d.identifierValue } : null,
  });

  await createEpisode(user, {
    vehicleId: vehicle.id,
    dealType: d.dealType,
    acquisitionSourceId: d.acquisitionSourceId ?? null,
    expectedArrivalAt: d.expectedArrivalAt ?? null,
    askingPrice: d.askingPrice ?? null,
    // Confidential economics only from users holding the grant.
    purchasePrice: canViewField(user, "acquisition_cost") ? d.purchasePrice ?? null : null,
    minimumAcceptablePrice: canViewField(user, "min_price") ? d.minimumAcceptablePrice ?? null : null,
    ownerNotes: canViewField(user, "owner_notes") ? d.ownerNotes ?? null : null,
  });

  revalidatePath("/vehicles");
  redirect(`/vehicles/${vehicle.id}`);
}

const addIdentifierSchema = z.object({
  vehicleId: z.string().uuid(),
  type: z.nativeEnum(IdentifierType),
  value: z.string().trim().min(1),
  isPrimary: z.coerce.boolean().default(false),
});

export async function addIdentifierAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "vehicles");
  const parsed = addIdentifierSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { vehicleId, type, value, isPrimary } = parsed.data;
  await addIdentifier(user, vehicleId, type, value, isPrimary);
  revalidatePath(`/vehicles/${vehicleId}`);
}
