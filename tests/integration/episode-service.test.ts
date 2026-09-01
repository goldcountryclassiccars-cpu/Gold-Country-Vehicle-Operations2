/**
 * Integration tests — run against the local development database.
 * Verifies episode creation, status transitions, price history, and audit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { changeEpisodeStatus, createEpisode, setAskingPrice, StatusError } from "@/modules/episodes/service";

let user: SessionUser;
let vehicleId: string;
let episodeId: string;

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const tpl = ROLE_TEMPLATES.find((t) => t.key === "owner")!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: "owner",
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
    roleKeys: ["owner"],
    isOwner: true,
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
  const vehicle = await db.vehicle.create({
    data: { make: "TestMake", model: "TestModel", year: 1960 },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  if (episodeId) {
    await db.statusChange.deleteMany({ where: { episodeId } });
    await db.arrangement.deleteMany({ where: { episodeId } });
    await db.inventoryEpisode.delete({ where: { id: episodeId } });
  }
  await db.vehicle.delete({ where: { id: vehicleId } });
  await db.$disconnect();
});

describe("episode lifecycle", () => {
  it("creates an episode with a generated stock number and custody history", async () => {
    const episode = await createEpisode(user, {
      vehicleId,
      dealType: "CONSIGNMENT",
      askingPrice: 10000,
      purchasePrice: null,
      ownerNotes: "integration test",
    });
    episodeId = episode.id;
    expect(episode.stockNumber).toMatch(/^GC-\d{4,}$/);
    expect(episode.custodyStatus).toBe("EXPECTED");
    const history = await db.statusChange.findMany({ where: { episodeId } });
    expect(history.some((h) => h.dimension === "custody" && h.toValue === "EXPECTED")).toBe(true);
  });

  it("changes status, appends history, sets arrival timestamp", async () => {
    const updated = await changeEpisodeStatus(user, episodeId, "custody", "ON_SITE", "arrived");
    expect(updated.custodyStatus).toBe("ON_SITE");
    expect(updated.actualArrivalAt).not.toBeNull();
    const history = await db.statusChange.findMany({ where: { episodeId, dimension: "custody" }, orderBy: { createdAt: "asc" } });
    expect(history.at(-1)?.fromValue).toBe("EXPECTED");
    expect(history.at(-1)?.toValue).toBe("ON_SITE");
    expect(history.at(-1)?.reason).toBe("arrived");
  });

  it("rejects invalid status values", async () => {
    await expect(changeEpisodeStatus(user, episodeId, "custody", "NOT_A_STATUS")).rejects.toThrow(StatusError);
  });

  it("records price changes with history", async () => {
    const updated = await setAskingPrice(user, episodeId, 12500, "market adjustment");
    expect(Number(updated.askingPrice)).toBe(12500);
    const history = await db.statusChange.findFirst({
      where: { episodeId, dimension: "asking_price" },
      orderBy: { createdAt: "desc" },
    });
    expect(history?.toValue).toBe("12500");
  });

  it("audits mutations with the real actor", async () => {
    const events = await db.auditEvent.findMany({
      where: { resourceId: episodeId },
      orderBy: { createdAt: "asc" },
    });
    const actions = events.map((e) => e.action);
    expect(actions).toContain("episode.create");
    expect(actions).toContain("episode.status.custody");
    expect(actions).toContain("episode.price.update");
    expect(events.every((e) => e.actorId === user.id)).toBe(true);
  });

  it("financial close deactivates the episode", async () => {
    const updated = await changeEpisodeStatus(user, episodeId, "financial", "FINANCIALLY_CLOSED");
    expect(updated.active).toBe(false);
    expect(updated.closedAt).not.toBeNull();
  });
});
