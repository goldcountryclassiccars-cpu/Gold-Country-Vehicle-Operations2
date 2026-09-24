/**
 * Deleting a vehicle (the archive) — the guard that matters:
 * a car with a live deal cannot be deleted, because that would hide the sale
 * from every screen that knows how to finish it. Once the deal is canceled,
 * the delete goes through.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { archiveEpisode, StatusError } from "@/modules/episodes/service";

function adminUser(base: { id: string; name: string; email: string }): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === "admin")!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: tpl.key,
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  return {
    id: base.id,
    sessionId: "test",
    name: base.name,
    email: base.email,
    roleKeys: ["admin"],
    isOwner: true,
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
}

let admin: SessionUser;
let vehicleId: string;
let episodeId: string;
let buyerId: string;
let saleId: string;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  admin = adminUser(jade);
  const vehicle = await db.vehicle.create({ data: { make: "ZZTestDelete", model: "Guard" } });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: { vehicleId, stockNumber: `ZZDG-${Date.now()}`, dealType: "CONSIGNMENT" },
  });
  episodeId = episode.id;
  const buyer = await db.party.create({ data: { kind: "PERSON", displayName: "ZZTest Delete Buyer" } });
  buyerId = buyer.id;
  const sale = await db.saleTransaction.create({
    data: { episodeId, buyerPartyId: buyerId, agreedPrice: 10000, createdById: admin.id },
  });
  saleId = sale.id;
});

afterAll(async () => {
  await db.saleDocumentRequirement.deleteMany({ where: { saleId } });
  await db.saleTransaction.delete({ where: { id: saleId } }).catch(() => {});
  await db.party.delete({ where: { id: buyerId } }).catch(() => {});
  await db.statusChange.deleteMany({ where: { episodeId } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } }).catch(() => {});
  await db.vehicle.delete({ where: { id: vehicleId } }).catch(() => {});
});

describe("deleting a vehicle", () => {
  it("refuses while a deal is in progress", async () => {
    await expect(archiveEpisode(admin, episodeId, "trying to delete a car mid-deal")).rejects.toThrow(
      StatusError,
    );
    const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(episode.active).toBe(true); // untouched
  });

  it("goes through once the deal is canceled, keeping history", async () => {
    await db.saleTransaction.update({ where: { id: saleId }, data: { status: "CANCELED" } });

    const archived = await archiveEpisode(admin, episodeId, "Demo car — removing from inventory");
    expect(archived.active).toBe(false);
    expect(archived.archivedAt).not.toBeNull();

    // The canceled sale and the status history both survive the delete.
    expect(await db.saleTransaction.count({ where: { episodeId } })).toBe(1);
    const change = await db.statusChange.findFirst({
      where: { episodeId, dimension: "active", toValue: "false" },
    });
    expect(change?.reason).toContain("Demo car");
  });
});
