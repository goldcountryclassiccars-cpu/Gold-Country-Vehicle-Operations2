/**
 * Vehicle domain services. Callers authorize BEFORE calling (requirePermission).
 */
import { IdentifierType, MileageStatus, Prisma } from "@prisma/client";
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
