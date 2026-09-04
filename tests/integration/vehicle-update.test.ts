/**
 * Integration tests for correcting a vehicle record.
 *
 * This path did not exist until 2026-09-04: the vehicle record was write-once,
 * so a car imported with mileage status left at Unknown was stuck that way. The
 * tests below protect the properties that make the fix safe to hand to staff —
 * a partial payload cannot blank out untouched fields, and the audit trail says
 * exactly what changed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { updateVehicle } from "@/modules/vehicles/service";

let user: SessionUser;
let vehicleId: string;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const tpl = ROLE_TEMPLATES.find((t) => t.key === "admin")!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: "admin",
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  user = {
    id: jade.id,
    sessionId: "test-session",
    name: jade.name,
    email: jade.email,
    roleKeys: ["admin"],
    isOwner: true,
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
  const vehicle = await db.vehicle.create({
    data: { make: "ZZEditTest", model: "Sprite", year: 1959, exteriorColor: "Blue", mileage: 56607 },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  await db.vehicle.deleteMany({ where: { make: "ZZEditTest" } });
  await db.$disconnect();
});

describe("updateVehicle", () => {
  it("sets the odometer disclosure that the import left as Unknown", async () => {
    const before = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(before.mileageStatus).toBe("UNKNOWN");

    const after = await updateVehicle(user, vehicleId, { mileageStatus: "EXEMPT" });
    expect(after.mileageStatus).toBe("EXEMPT");
  });

  it("leaves fields the caller did not send alone", async () => {
    await updateVehicle(user, vehicleId, { exteriorColor: "Healey Blue" });
    const v = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.exteriorColor).toBe("Healey Blue");
    expect(v.model).toBe("Sprite");
    expect(v.mileage).toBe(56607);
    expect(v.mileageStatus).toBe("EXEMPT");
  });

  it("clears a field when explicitly given null, rather than ignoring it", async () => {
    await updateVehicle(user, vehicleId, { trim: "Bugeye" });
    await updateVehicle(user, vehicleId, { trim: null });
    const v = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.trim).toBeNull();
  });

  it("records the before and after of only the fields that changed", async () => {
    await updateVehicle(user, vehicleId, { mileage: 56610, model: "Sprite" });
    const event = await db.auditEvent.findFirst({
      where: { action: "vehicle.update", resourceId: vehicleId },
      orderBy: { createdAt: "desc" },
    });
    expect(event!.newValues).toEqual({ mileage: 56610 });
    expect(event!.previousValues).toEqual({ mileage: 56607 });
  });

  it("writes nothing at all when nothing differs", async () => {
    const countBefore = await db.auditEvent.count({ where: { action: "vehicle.update", resourceId: vehicleId } });
    await updateVehicle(user, vehicleId, { model: "Sprite", mileage: 56610 });
    const countAfter = await db.auditEvent.count({ where: { action: "vehicle.update", resourceId: vehicleId } });
    expect(countAfter).toBe(countBefore);
  });
});
