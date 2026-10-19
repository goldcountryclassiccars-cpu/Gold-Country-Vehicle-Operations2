/**
 * Listing Tool — the rules that matter in the real shop:
 * - intake photos and listing photos never mix;
 * - a listing holds at most 100 photos, even when uploads race;
 * - photo order saves only as a complete, current list;
 * - publishing needs the required items, and marketplaces refuse sold cars;
 * - a feed pickup is what makes a listing live, and a sold car drops off a
 *   marketplace at the next pickup while staying on our website;
 * - the shop can add listing photos but cannot write, arrange or publish.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { hasPermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { storage } from "@/lib/adapters/storage";
import {
  finalizePhotoUpload,
  LISTING_PHOTO_LIMIT,
  MediaError,
  mediaReadiness,
  requestPhotoUpload,
} from "@/modules/media/service";
import {
  copyIntakePhotosToListing,
  ensureChannels,
  feedForChannel,
  ListingError,
  listingMedia,
  markPublicationLive,
  publishListing,
  recordFeedPickup,
  reorderListingPhotos,
  saveListing,
  setCoverPhoto,
  startListing,
  unpublishListing,
  updateChannel,
} from "@/modules/listings/service";

function sessionUserFor(roleKey: string, base: { id: string; name: string; email: string }): SessionUser {
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
    id: base.id, sessionId: "test", name: base.name, email: base.email, roleKeys: [roleKey],
    isOwner: roleKey === "admin", previewRoleKey: null, departmentIds: [], departmentKeys: [],
    permissions, fieldGrants, defaultLandingPage: null,
  };
}

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

let admin: SessionUser;
let vehicleId: string;
let episodeId: string;
const keys: string[] = [];
let channelSnapshot: { key: string; method: "FEED" | "MANUAL"; enabled: boolean }[] = [];

/** Seeds listing photos straight into the database (fast — no storage). */
async function seedListingPhotos(n: number) {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const start = await db.mediaAsset.count({ where: { episodeId, purpose: "LISTING" } });
  for (let i = 0; i < n; i++) {
    const f = await db.fileObject.create({
      data: { storageKey: `zztest/${episodeId}/${start + i}-${Date.now()}`, adapter: "local", originalName: `p${i}.jpg`, contentType: "image/jpeg", sizeBytes: 10, uploadedBy: jade.id },
    });
    await db.mediaAsset.create({
      data: { episodeId, fileId: f.id, largeFileId: f.id, kind: "PHOTO", purpose: "LISTING", category: "listing", sortOrder: start + i + 1, uploadedById: jade.id },
    });
  }
}

async function uploadListingPhoto(name: string) {
  const { targets } = await requestPhotoUpload(admin, {
    episodeId, fileName: name, contentType: "image/jpeg", sizeBytes: TINY_JPEG.length, purpose: "LISTING",
  });
  for (const t of targets) {
    await storage().put(t.key, TINY_JPEG);
    keys.push(t.key);
  }
  const k = (v: string) => targets.find((t) => t.variant === v)!.key;
  return { targets, finalize: () => finalizePhotoUpload(admin, {
    episodeId, originalName: name, contentType: "image/jpeg", originalKey: k("original"), webKey: k("web"), thumbKey: k("thumb"), largeKey: k("large"), purpose: "LISTING",
  }) };
}

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  const channels = await ensureChannels();
  channelSnapshot = channels.map((c) => ({ key: c.key, method: c.method, enabled: c.enabled }));
  const vehicle = await db.vehicle.create({
    data: {
      make: "ZZTEST", model: "Roadster", year: 1932, bodyStyle: "Highboy", exteriorColor: "Black", engineDescription: "350 V8",
      mileageStatus: "EXEMPT", generalDescription: "A steel-bodied highboy that has been driven and enjoyed for years.",
      identifiers: { create: { type: "SERIAL_NUMBER", value: `ZZTEST${Date.now()}`, isPrimary: true } },
    },
  });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: { vehicleId, stockNumber: `ZZTEST-${Date.now()}`, dealType: "CONSIGNMENT", askingPrice: 79900 },
  });
  episodeId = episode.id;
});

afterAll(async () => {
  const listing = await db.listing.findUnique({ where: { episodeId } });
  if (listing) {
    await db.listingPublication.deleteMany({ where: { listingId: listing.id } });
    await db.listing.delete({ where: { id: listing.id } });
  }
  const assets = await db.mediaAsset.findMany({ where: { episodeId } });
  const fileIds = assets.flatMap((a) => [a.fileId, a.webFileId, a.thumbFileId, a.largeFileId]).filter(Boolean) as string[];
  await db.mediaAsset.deleteMany({ where: { episodeId } });
  await db.fileObject.deleteMany({ where: { id: { in: fileIds } } });
  await db.videoLink.deleteMany({ where: { episodeId } });
  await db.integrationEvent.deleteMany({ where: { episodeId } });
  await db.statusChange.deleteMany({ where: { episodeId } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } });
  await db.vehicleIdentifier.deleteMany({ where: { vehicleId } });
  await db.vehicle.delete({ where: { id: vehicleId } });
  for (const k of keys) await storage().delete(k);
  for (const c of channelSnapshot) await db.listingChannel.update({ where: { key: c.key }, data: { method: c.method, enabled: c.enabled } });
});

describe("starting a listing", () => {
  it("prefills from the vehicle record", async () => {
    const l = await startListing(admin, episodeId);
    expect(l.title).toBe("1932 ZZTEST Roadster Highboy");
    expect(l.description).toMatch(/steel-bodied highboy/);
    expect((await startListing(admin, episodeId)).id).toBe(l.id); // idempotent
  });

  it("saves the write-up, bumps the version only on change, and sets price via the episode", async () => {
    const before = (await db.listing.findUniqueOrThrow({ where: { episodeId } })).contentVersion;
    const r = await saveListing(admin, episodeId, { title: "1932 Ford Highboy Roadster", highlights: ["• Steel body", "- 350 V8", ""], askingPrice: 82500 });
    expect(r.changed).toEqual(expect.arrayContaining(["title", "highlights", "price"]));
    expect(r.listing.highlights).toEqual(["Steel body", "350 V8"]);
    expect(r.listing.contentVersion).toBe(before + 1);
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(Number(ep.askingPrice)).toBe(82500);
    expect(await db.statusChange.count({ where: { episodeId, dimension: "asking_price" } })).toBe(1);
    const again = await saveListing(admin, episodeId, { title: "1932 Ford Highboy Roadster" });
    expect(again.changed).toEqual([]);
    expect(again.listing.contentVersion).toBe(before + 1);
    await expect(saveListing(admin, episodeId, { title: "  " })).rejects.toThrow(ListingError);
  });
});

describe("listing photos", () => {
  it("upload issues a large variant and lands as LISTING, apart from intake", async () => {
    const up = await uploadListingPhoto("front.jpg");
    expect(up.targets.map((t) => t.variant).sort()).toEqual(["large", "original", "thumb", "web"]);
    const asset = await up.finalize();
    expect(asset.purpose).toBe("LISTING");
    expect(asset.largeFileId).toBeTruthy();
    // Intake readiness ignores listing photos.
    const intake = await mediaReadiness(episodeId);
    expect(intake.items.every((i) => i.count === 0)).toBe(true);
  });

  it("intake uploads never get the large variant", async () => {
    const { targets } = await requestPhotoUpload(admin, { episodeId, fileName: "vin.jpg", contentType: "image/jpeg", sizeBytes: 10 });
    expect(targets.map((t) => t.variant)).not.toContain("large");
  });

  it("copies chosen intake photos onto the listing without touching intake", async () => {
    const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
    const f = await db.fileObject.create({ data: { storageKey: `zztest/${episodeId}/intake-1`, adapter: "local", originalName: "i.jpg", contentType: "image/jpeg", sizeBytes: 10, uploadedBy: jade.id } });
    const intake = await db.mediaAsset.create({ data: { episodeId, fileId: f.id, kind: "PHOTO", purpose: "INTAKE", category: "other", uploadedById: jade.id } });
    const r = await copyIntakePhotosToListing(admin, episodeId, [intake.id]);
    expect(r.added).toBe(1);
    const media = await listingMedia(episodeId);
    expect(media.photos.at(-1)!.fileId).toBe(f.id);
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: intake.id } })).purpose).toBe("INTAKE");
  });

  it("reorders only with the complete, current list; cover moves to the front", async () => {
    const { photos } = await listingMedia(episodeId);
    const ids = photos.map((p) => p.id);
    await expect(reorderListingPhotos(admin, episodeId, ids.slice(1))).rejects.toThrow(ListingError);
    await expect(reorderListingPhotos(admin, episodeId, [...ids, ids[0]!])).rejects.toThrow(ListingError);
    await reorderListingPhotos(admin, episodeId, [...ids].reverse());
    expect((await listingMedia(episodeId)).photos.map((p) => p.id)).toEqual([...ids].reverse());
    await setCoverPhoto(admin, episodeId, ids[0]!);
    expect((await listingMedia(episodeId)).photos[0]!.id).toBe(ids[0]);
  });

  it(`caps a listing at ${LISTING_PHOTO_LIMIT} photos — at request and again at finalize`, async () => {
    const have = (await listingMedia(episodeId)).photos.length;
    await seedListingPhotos(LISTING_PHOTO_LIMIT - have - 1); // one slot left
    // Two uploads requested while one slot is free…
    const a = await uploadListingPhoto("a.jpg");
    const b = await uploadListingPhoto("b.jpg");
    await a.finalize();
    // …the second is refused at finalize, and its stored files are cleaned up.
    await expect(b.finalize()).rejects.toThrow(MediaError);
    expect(await storage().head(b.targets[0]!.key)).toBeNull();
    expect((await listingMedia(episodeId)).photos.length).toBe(LISTING_PHOTO_LIMIT);
    await expect(
      requestPhotoUpload(admin, { episodeId, fileName: "c.jpg", contentType: "image/jpeg", sizeBytes: 10, purpose: "LISTING" }),
    ).rejects.toThrow(/already has 100 photos/);
  });
});

describe("publishing and feeds", () => {
  it("refuses until required items are there", async () => {
    await saveListing(admin, episodeId, { title: "1932 Ford Highboy Roadster", description: "short" });
    await expect(publishListing(admin, episodeId, ["website"])).rejects.toThrow(/overview written/);
    await saveListing(admin, episodeId, { title: "1932 Ford Highboy Roadster", description: "A genuine steel-bodied highboy, sorted and ready to drive anywhere." });
  });

  it("publishes; a FEED pickup makes it live and marks the car listed", async () => {
    await updateChannel(admin, "website", { method: "FEED", enabled: true });
    await updateChannel(admin, "hemmings", { method: "FEED", enabled: true });
    await publishListing(admin, episodeId, ["website", "hemmings"]);
    const ep1 = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep1.marketingStatus).toBe("SUBMITTED_TO_LISTING_SYSTEM");

    const feed = await feedForChannel("website");
    const mine = feed.listings.find((l) => l.stockNumber === ep1.stockNumber)!;
    expect(mine.photos).toHaveLength(LISTING_PHOTO_LIMIT);
    expect(mine.photos[0]!.url).toMatch(/\/api\/listings\/media\//);
    expect(mine.price).toBe(82500);
    expect(mine.descriptionText).toContain("Highlights:");
    await recordFeedPickup("website", feed, "test-agent");

    const listing = await db.listing.findUniqueOrThrow({ where: { episodeId }, include: { publications: true } });
    const web = listing.publications.find((p) => p.channelKey === "website")!;
    expect(web.status).toBe("LIVE");
    expect(web.deliveredVersion).toBe(listing.contentVersion);
    const ep2 = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(ep2.marketingStatus).toBe("LIVE");
    expect(ep2.firstListedAt).not.toBeNull();
    // Hemmings has not picked up yet.
    expect(listing.publications.find((p) => p.channelKey === "hemmings")!.status).toBe("QUEUED");
  });

  it("a sold car leaves the marketplace at its next pickup but stays on our website", async () => {
    const hemFirst = await feedForChannel("hemmings");
    await recordFeedPickup("hemmings", hemFirst, null);
    await db.inventoryEpisode.update({ where: { id: episodeId }, data: { salesStatus: "DELIVERED" } });

    const hem = await feedForChannel("hemmings");
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(hem.listings.some((l) => l.stockNumber === ep.stockNumber)).toBe(false);
    await recordFeedPickup("hemmings", hem, null);
    const pubs = (await db.listing.findUniqueOrThrow({ where: { episodeId }, include: { publications: true } })).publications;
    expect(pubs.find((p) => p.channelKey === "hemmings")!.status).toBe("OFF");

    const web = await feedForChannel("website");
    expect(web.listings.find((l) => l.stockNumber === ep.stockNumber)?.availability).toBe("sold");

    await expect(publishListing(admin, episodeId, ["classiccars"])).rejects.toThrow(/sold/);
    await db.inventoryEpisode.update({ where: { id: episodeId }, data: { salesStatus: "AVAILABLE" } });
  });

  it("manual channels: publish queues it, Mark live records it, take down turns it off", async () => {
    await updateChannel(admin, "classiccars", { method: "MANUAL", enabled: true });
    await publishListing(admin, episodeId, ["classiccars"]);
    await expect(markPublicationLive(admin, episodeId, "classiccars", "not a url")).rejects.toThrow(ListingError);
    const pub = await markPublicationLive(admin, episodeId, "classiccars", "https://classiccars.com/listings/view/1");
    expect(pub.status).toBe("LIVE");
    await unpublishListing(admin, episodeId, "classiccars");
    const pubs = (await db.listing.findUniqueOrThrow({ where: { episodeId }, include: { publications: true } })).publications;
    expect(pubs.find((p) => p.channelKey === "classiccars")!.status).toBe("OFF");
  });

  it("a feed never carries intake photos", async () => {
    const feed = await feedForChannel("website");
    const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    const mine = feed.listings.find((l) => l.stockNumber === ep.stockNumber)!;
    const intakeIds = (await db.mediaAsset.findMany({ where: { episodeId, purpose: "INTAKE" } })).map((a) => a.id);
    expect(mine.photos.some((p) => intakeIds.some((id) => p.url.endsWith(id)))).toBe(false);
  });
});

describe("permissions", () => {
  it("shop adds listing photos but cannot write, arrange or publish; front desk can do it all", () => {
    const u = { id: "x", name: "x", email: "x" };
    const shop = sessionUserFor("shop", u);
    const desk = sessionUserFor("front_desk", u);
    expect(hasPermission(shop, "listings", "view")).toBe(true);
    expect(hasPermission(shop, "listings", "create")).toBe(true);
    expect(hasPermission(shop, "listings", "edit")).toBe(false);
    expect(hasPermission(shop, "listings", "generate")).toBe(false);
    for (const a of ["view", "create", "edit", "generate"] as const) expect(hasPermission(desk, "listings", a)).toBe(true);
    expect(hasPermission(desk, "listings", "manage_config")).toBe(false);
  });
});
