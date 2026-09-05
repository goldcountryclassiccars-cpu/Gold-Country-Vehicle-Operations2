/**
 * Vehicle domain services. Callers authorize BEFORE calling (requirePermission).
 */
import { FuelType, IdentifierType, MileageStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";
import { getScope } from "@/lib/authz/engine";

/** Scoped where-clause for vehicle list reads (via visible episodes). */
export function vehicleWhereForUser(user: SessionUser): Prisma.VehicleWhereInput {
  const scope = getScope(user, "vehicles", "view");
  if (scope === "ALL") return {};
  if (scope === "NONE") return { id: "__none__" };
  return {
    episodes: { some: { OR: [{ salespersonId: user.id }, { operationsOwnerId: user.id }] } },
  };
}

export interface CreateVehicleInput {
  year?: number | null;
  make: string;
  model: string;
  trim?: string | null;
  bodyStyle?: string | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  engineDescription?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  mileage?: number | null;
  mileageStatus?: MileageStatus;
  generalDescription?: string | null;
  identifier?: { type: IdentifierType; value: string } | null;
}

export async function createVehicle(user: SessionUser, input: CreateVehicleInput) {
  const vehicle = await db.vehicle.create({
    data: {
      year: input.year ?? null,
      make: input.make,
      model: input.model,
      trim: input.trim ?? null,
      bodyStyle: input.bodyStyle ?? null,
      exteriorColor: input.exteriorColor ?? null,
      interiorColor: input.interiorColor ?? null,
      engineDescription: input.engineDescription ?? null,
      transmission: input.transmission ?? null,
      drivetrain: input.drivetrain ?? null,
      mileage: input.mileage ?? null,
      mileageStatus: input.mileageStatus ?? "UNKNOWN",
      generalDescription: input.generalDescription ?? null,
      identifiers: input.identifier?.value
        ? { create: { type: input.identifier.type, value: input.identifier.value, isPrimary: true } }
        : undefined,
    },
  });
  await audit(user, {
    action: "vehicle.create",
    resourceType: "vehicle",
    resourceId: vehicle.id,
    newValues: { year: input.year, make: input.make, model: input.model },
  });
  return vehicle;
}

/** Fields of the vehicle record that can be corrected after creation. */
export interface UpdateVehicleInput {
  year?: number | null;
  make?: string;
  model?: string;
  trim?: string | null;
  bodyStyle?: string | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  engineDescription?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  mileage?: number | null;
  mileageStatus?: MileageStatus;
  generalDescription?: string | null;
  fuelType?: FuelType | null;
  isMotorcycle?: boolean;
}

const EDITABLE_FIELDS = [
  "year",
  "make",
  "model",
  "trim",
  "bodyStyle",
  "exteriorColor",
  "interiorColor",
  "engineDescription",
  "transmission",
  "drivetrain",
  "mileage",
  "mileageStatus",
  "generalDescription",
  // Both drive sale-document rules: electric and pre-1998 diesel are smog
  // exempt, and a motorcycle needs neither a Buyers Guide nor a smog check.
  "fuelType",
  "isMotorcycle",
] as const;

/**
 * Corrects the vehicle record.
 *
 * Until this existed the record was write-once: a car entered with the wrong
 * color, a mistyped mileage, or mileage status left at Unknown was stuck that
 * way forever, because nothing in the app issued a vehicle update. That is not
 * survivable for real inventory — data gets entered before it is fully known,
 * and an odometer disclosure in particular has to be correctable.
 *
 * Only fields actually present in the input are touched, so a partial form
 * cannot blank out everything it did not send. The audit event records the
 * before and after of exactly the fields that changed, and nothing is written
 * when nothing differs.
 */
export async function updateVehicle(user: SessionUser, vehicleId: string, input: UpdateVehicleInput) {
  const before = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });

  const data: Record<string, unknown> = {};
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const next = (input as Record<string, unknown>)[field];
    if (next === undefined) continue;
    const current = (before as unknown as Record<string, unknown>)[field];
    if (current === next) continue;
    data[field] = next;
    previousValues[field] = current;
    newValues[field] = next;
  }

  if (Object.keys(data).length === 0) return before;

  const updated = await db.vehicle.update({ where: { id: vehicleId }, data });
  await audit(user, {
    action: "vehicle.update",
    resourceType: "vehicle",
    resourceId: vehicleId,
    previousValues,
    newValues,
  });

  // The document rules read the vehicle, so a correction here can change what
  // paperwork a live deal needs. Refresh every open sale on this car.
  const { reevaluateEpisodeSales } = await import("@/modules/documents/requirements");
  const episodes = await db.inventoryEpisode.findMany({ where: { vehicleId }, select: { id: true } });
  for (const episode of episodes) await reevaluateEpisodeSales(user, episode.id);

  return updated;
}

export async function addIdentifier(
  user: SessionUser,
  vehicleId: string,
  type: IdentifierType,
  value: string,
  isPrimary = false,
) {
  if (isPrimary) {
    await db.vehicleIdentifier.updateMany({ where: { vehicleId }, data: { isPrimary: false } });
  }
  const identifier = await db.vehicleIdentifier.create({
    data: { vehicleId, type, value, isPrimary },
  });
  await audit(user, {
    action: "vehicle.identifier.add",
    resourceType: "vehicle",
    resourceId: vehicleId,
    newValues: { type, value, isPrimary },
  });
  return identifier;
}

export function vehicleLabel(v: { year: number | null; make: string; model: string; trim?: string | null }): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}
