/**
 * Integration tests for Phase 5: media readiness, listing readiness, and the
 * integration outbox (idempotency).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { emitIntegrationEvent, listingReadiness, mediaReadiness } from "@/modules/media/service";

let vehicleId: string;
let episodeId: string;
const fileIds: string[] = [];
const eventKeys: string[] = [];

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const vehicle = await db.vehicle.create({
    data: {
      make: "MediaTest", model: "M", year: 1970, exteriorColor: "Red", engineDescription: "V8",
      identifiers: { create: { type: "SHORT_VIN", value: `MT${Date.now()}`, isPrimary: true } },
    },
  });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: {
      vehicleId,
      stockNumber: `MT-${Date.now()}`,
      dealType: "DEALER_PURCHASE",
      askingPrice: 25000,
      reconditioningStatus: "NO_WORK_REQUIRED",
      intake: { create: { status: "complete", receivedById: jade.id, completedAt: new Date() } },
    },
  });
  episodeId = episode.id;

  // Satisfy every required checklist category with a fake asset.
  const required = await db.mediaChecklistItem.findMany({ where: { active: true, required: true } });
  for (const item of required) {
    const file = await db.fileObject.create({
      data: {
        storageKey: `test/${episodeId}/${item.key}`,
        adapter: "local",
        originalName: `${item.key}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 10,
        uploadedBy: jade.id,
      },
    });
    fileIds.push(file.id);
    await db.mediaAsset.create({
      data: { episodeId, fileId: file.id, kind: "PHOTO", category: item.key, uploadedById: jade.id },
    });
  }
});

afterAll(async () => {
  await db.mediaAsset.deleteMany({ where: { episodeId } });
  await db.fileObject.deleteMany({ where: { id: { in: fileIds } } });
  await db.integrationEvent.deleteMany({ where: { idempotencyKey: { in: eventKeys } } });
  await db.intakeRecord.deleteMany({ where: { episodeId } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } });
  await db.vehicle.delete({ where: { id: vehicleId } });
  await db.$disconnect();
});

describe("media readiness", () => {
  it("is complete when every required category has an asset", async () => {
    const m = await mediaReadiness(episodeId);
    expect(m.requiredTotal).toBeGreaterThan(0);
    expect(m.requiredSatisfied).toBe(m.requiredTotal);
    expect(m.complete).toBe(true);
  });
});

describe("listing readiness", () => {
  it("passes all checks for a fully prepared vehicle", async () => {
    const r = await listingReadiness(episodeId);
    const failing = r.checks.filter((c) => !c.ok).map((c) => c.key);
    expect(failing).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("fails when the price is missing", async () => {
    await db.inventoryEpisode.update({ where: { id: episodeId }, data: { askingPrice: null } });
    const r = await listingReadiness(episodeId);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === "price")?.ok).toBe(false);
    await db.inventoryEpisode.update({ where: { id: episodeId }, data: { askingPrice: 25000 } });
  });
});

describe("integration outbox", () => {
  it("duplicate emits collapse onto one event (idempotency key)", async () => {
    const a = await emitIntegrationEvent("test.event", episodeId, { n: 1 });
    eventKeys.push(a.idempotencyKey);
    const b = await emitIntegrationEvent("test.event", episodeId, { n: 1 });
    expect(b.id).toBe(a.id);
    const c = await emitIntegrationEvent("test.event", episodeId, { n: 2 });
    eventKeys.push(c.idempotencyKey);
    expect(c.id).not.toBe(a.id);
  });
});
