/**
 * Integration tests for the inventory import — run against the local
 * development database.
 *
 * The behaviours worth protecting are the ones that would cost real work to
 * undo: a file uploaded twice must not create the car twice, a bad row must not
 * stop the good rows, confidential columns must not be written by someone whose
 * role cannot see them, and the aging clock must start when the dealership
 * actually took the car — not on the day it was typed in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { toCsv } from "@/modules/import/csv";
import { TEMPLATE_HEADER } from "@/modules/import/columns";
import { commitImport, planImport } from "@/modules/import/service";

const MARKER = "ZZTestImport";

function sessionUserFrom(id: string, name: string, email: string, roleKey: string): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === roleKey)!;
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
    id,
    sessionId: "test-session",
    name,
    email,
    roleKeys: [roleKey],
    isOwner: roleKey === "admin",
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
}

/** Build a CSV from partial rows, filling unspecified columns with blanks. */
function csv(rows: Record<string, string>[]): string {
  return toCsv([TEMPLATE_HEADER, ...rows.map((r) => TEMPLATE_HEADER.map((k) => r[k] ?? ""))]);
}

let admin: SessionUser;
let frontDesk: SessionUser;
const createdEpisodeIds: string[] = [];
const createdVehicleIds: string[] = [];

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  admin = sessionUserFrom(jade.id, jade.name, jade.email, "admin");
  frontDesk = sessionUserFrom(jade.id, jade.name, jade.email, "front_desk");
});

afterAll(async () => {
  const vehicles = await db.vehicle.findMany({ where: { make: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdVehicleIds, ...vehicles.map((v) => v.id)])];
  const episodes = await db.inventoryEpisode.findMany({ where: { vehicleId: { in: ids } }, select: { id: true } });
  const episodeIds = [...new Set([...createdEpisodeIds, ...episodes.map((e) => e.id)])];
  await db.statusChange.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.arrangement.deleteMany({ where: { episodeId: { in: episodeIds } } });
  await db.inventoryEpisode.deleteMany({ where: { id: { in: episodeIds } } });
  await db.vehicleIdentifier.deleteMany({ where: { vehicleId: { in: ids } } });
  await db.vehicle.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

async function track(result: { created: { stockNumber: string }[] }) {
  const episodes = await db.inventoryEpisode.findMany({
    where: { stockNumber: { in: result.created.map((c) => c.stockNumber) } },
    select: { id: true, vehicleId: true },
  });
  createdEpisodeIds.push(...episodes.map((e) => e.id));
  createdVehicleIds.push(...episodes.map((e) => e.vehicleId));
  return episodes;
}

describe("planImport", () => {
  it("refuses a file that is missing a required column, and says which", async () => {
    const plan = await planImport(admin, "year,make\n1962,Chevrolet\n");
    expect(plan.fatal).toContain("model");
    expect(plan.fatal).toContain("deal_type");
    expect(plan.rows).toHaveLength(0);
  });

  it("refuses a file with no data rows", async () => {
    const plan = await planImport(admin, toCsv([TEMPLATE_HEADER]));
    expect(plan.fatal).toContain("No data rows");
  });

  it("flags unknown columns without failing the file", async () => {
    const text = "make,model,deal_type,favourite_colour\nZZTestImport,Sprite,Consignment,blue\n";
    const plan = await planImport(admin, text);
    expect(plan.unknownColumns).toEqual(["favourite_colour"]);
    expect(plan.counts.ready).toBe(1);
  });

  it("reports every problem on a row at once rather than stopping at the first", async () => {
    const plan = await planImport(
      admin,
      csv([{ make: MARKER, model: "Bad", deal_type: "floorplan", asking_price: "call me", year: "nineteen sixty" }]),
    );
    expect(plan.rows[0]!.status).toBe("error");
    expect(plan.rows[0]!.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("does not write anything while planning", async () => {
    const before = await db.vehicle.count();
    await planImport(admin, csv([{ make: MARKER, model: "DryRun", deal_type: "Consignment" }]));
    expect(await db.vehicle.count()).toBe(before);
  });

  it("catches a row pasted twice in the same file", async () => {
    const row = { make: MARKER, model: "Twice", deal_type: "Consignment", identifier_type: "Chassis", identifier_value: "DUPE-1" };
    const plan = await planImport(admin, csv([row, { ...row }]));
    expect(plan.rows[0]!.status).toBe("ready");
    expect(plan.rows[1]!.status).toBe("duplicate");
    expect(plan.rows[1]!.duplicateOf).toContain("row 1");
  });

  it("warns rather than guessing silently when the identifier type is blank", async () => {
    const plan = await planImport(
      admin,
      csv([{ make: MARKER, model: "Guess", deal_type: "Consignment", identifier_value: "ZZTEST0000001" }]),
    );
    expect(plan.rows[0]!.status).toBe("ready");
    expect(plan.rows[0]!.warnings.join(" ")).toContain("Short VIN");
  });

  it("tells a front-desk user that confidential columns will be ignored", async () => {
    const plan = await planImport(
      frontDesk,
      csv([{ make: MARKER, model: "Money", deal_type: "Consignment", purchase_price: "$20,000" }]),
    );
    expect(plan.rows[0]!.warnings.join(" ")).toContain("acquisition cost");
    expect(plan.rows[0]!.payload?.episode.purchasePrice).toBeNull();
  });
});

describe("commitImport", () => {
  it("creates the vehicle, its identifier, and an episode with a stock number", async () => {
    const plan = await planImport(
      admin,
      csv([
        {
          year: "1962",
          make: MARKER,
          model: "Corvette",
          trim: "Fuelie",
          exterior_color: "Black",
          mileage: "74,010",
          mileage_status: "Actual",
          identifier_type: "Short VIN",
          identifier_value: "ZZTEST0000002",
          deal_type: "Consignment",
          asking_price: "$73,900",
          custody_status: "On site",
          marketing_status: "Live",
          description: 'Triple black, 15" wheels, matching numbers.',
        },
      ]),
    );
    expect(plan.counts.ready).toBe(1);

    const result = await commitImport(admin, plan, new Set());
    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    const episode = (await track(result))[0]!;

    const saved = await db.inventoryEpisode.findUniqueOrThrow({
      where: { id: episode.id },
      include: { vehicle: { include: { identifiers: true } } },
    });
    expect(saved.stockNumber).toMatch(/^GC-\d{4}$/);
    expect(saved.dealType).toBe("CONSIGNMENT");
    expect(Number(saved.askingPrice)).toBe(73900);
    expect(saved.custodyStatus).toBe("ON_SITE");
    expect(saved.marketingStatus).toBe("LIVE");
    expect(saved.vehicle.mileage).toBe(74010);
    expect(saved.vehicle.mileageStatus).toBe("ACTUAL");
    expect(saved.vehicle.generalDescription).toContain('15" wheels');
    expect(saved.vehicle.identifiers[0]).toMatchObject({ type: "SHORT_VIN", value: "ZZTEST0000002", isPrimary: true });
  });

  it("records status history for the statuses the file set", async () => {
    const episodeId = createdEpisodeIds[createdEpisodeIds.length - 1]!;
    const changes = await db.statusChange.findMany({ where: { episodeId } });
    expect(changes.map((c) => c.dimension)).toEqual(expect.arrayContaining(["custody", "marketing"]));
    expect(changes.find((c) => c.dimension === "marketing")?.reason).toContain("import");
  });

  it("back-dates the aging clock to the acquired date", async () => {
    const plan = await planImport(
      admin,
      csv([{ make: MARKER, model: "OldStock", deal_type: "Dealer purchase", acquired_date: "2026-01-15" }]),
    );
    const result = await commitImport(admin, plan, new Set());
    const episode = (await track(result))[0]!;
    const saved = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(saved.acceptedAt?.toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("skips the whole file on a second upload instead of duplicating the cars", async () => {
    const text = csv([
      { make: MARKER, model: "Idempotent", deal_type: "Consignment", identifier_type: "VIN", identifier_value: "ZZTEST0000003" },
    ]);
    const first = await commitImport(admin, await planImport(admin, text), new Set());
    await track(first);
    expect(first.created).toHaveLength(1);

    const secondPlan = await planImport(admin, text);
    expect(secondPlan.rows[0]!.status).toBe("duplicate");
    const second = await commitImport(admin, secondPlan, new Set());
    expect(second.created).toHaveLength(0);

    const count = await db.vehicle.count({ where: { make: MARKER, model: "Idempotent" } });
    expect(count).toBe(1);
  });

  it("imports the good rows even when another row is broken", async () => {
    const plan = await planImport(
      admin,
      csv([
        { make: MARKER, model: "GoodOne", deal_type: "Consignment" },
        { make: MARKER, model: "BadOne", deal_type: "not a deal type" },
        { make: MARKER, model: "GoodTwo", deal_type: "Dealer purchase" },
      ]),
    );
    expect(plan.counts).toMatchObject({ ready: 2, error: 1 });
    const result = await commitImport(admin, plan, new Set());
    await track(result);
    expect(result.created.map((c) => c.label)).toEqual([`${MARKER} GoodOne`, `${MARKER} GoodTwo`]);
    expect(result.skipped).toBe(1);
  });

  it("holds back a possible duplicate until it is explicitly confirmed", async () => {
    const text = csv([{ year: "1932", make: MARKER, model: "NoVinHere", deal_type: "Consignment" }]);
    const first = await commitImport(admin, await planImport(admin, text), new Set());
    await track(first);

    const plan = await planImport(admin, text);
    expect(plan.rows[0]!.status).toBe("possible_duplicate");

    const notConfirmed = await commitImport(admin, plan, new Set());
    expect(notConfirmed.created).toHaveLength(0);

    const confirmed = await commitImport(admin, plan, new Set([1]));
    await track(confirmed);
    expect(confirmed.created).toHaveLength(1);
  });

  it("never writes a confidential value for a role that cannot see it", async () => {
    const text = csv([
      { make: MARKER, model: "Sealed", deal_type: "Consignment", purchase_price: "$20,000", minimum_price: "$25,000", owner_notes: "secret" },
    ]);
    const result = await commitImport(frontDesk, await planImport(frontDesk, text), new Set());
    const episode = (await track(result))[0]!;
    const arrangement = await db.arrangement.findUniqueOrThrow({ where: { episodeId: episode.id } });
    expect(arrangement.purchasePrice).toBeNull();
    expect(arrangement.minimumAcceptablePrice).toBeNull();
    expect(arrangement.ownerNotes).toBeNull();
  });

  it("writes an audit event naming what it created", async () => {
    const event = await db.auditEvent.findFirst({
      where: { action: "inventory.import" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(event!.newValues).toHaveProperty("created");
  });
});
