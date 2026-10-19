/**
 * Listing Tool — the write-up, the curated media, and where the listing is
 * published (our website, Hemmings, ClassicCars.com).
 *
 * Separation of truths: specs, VIN and mileage live on Vehicle; asking price
 * and availability on InventoryEpisode. A listing holds only the words and the
 * media choices, so the feed is always built from current facts — a price
 * change or a sale shows up on every channel at its next pickup without anyone
 * touching the listing.
 *
 * Delivery model: every channel is a FEED the destination pulls (our WordPress
 * site, or a marketplace's dealer-feed importer once their team sets it up) or
 * MANUAL (staff post by hand from the posting kit and mark it live). A feed
 * pickup is what moves a publication from QUEUED to LIVE, and is how a sold car
 * comes down — it simply stops appearing.
 */
import { randomBytes } from "crypto";
import type { Listing, ListingPublication, MediaAsset, Prisma, VideoLink } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import type { SessionUser } from "@/lib/authz/types";
import { bumpListingVersion, LISTING_PHOTO_LIMIT } from "@/modules/media/service";
import { vehicleLabel } from "@/modules/vehicles/service";
import {
  DEALER_PHONE,
  availabilityFor,
  composeDescription,
  DEALER,
  formatPrice,
  mileageNoteFor,
  videoKind,
  type Availability,
  type FeedDealer,
  type FeedListing,
} from "./feed";

export class ListingError extends Error {}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * Every place a car can be listed. `photoLimit` is how many photos the place
 * takes (the posting kit downloads that many, cover first); `tickedByDefault`
 * is whether the Publish box pre-ticks it — the hand-posted social channels are
 * opt-in per car so publishing never quietly creates six to-dos.
 */
export const CHANNEL_DEFAULTS = [
  { key: "website", name: "Our website", sortOrder: 1, photoLimit: null, tickedByDefault: true, kind: "site" },
  { key: "hemmings", name: "Hemmings", sortOrder: 2, photoLimit: null, tickedByDefault: true, kind: "marketplace" },
  { key: "classiccars", name: "ClassicCars.com", sortOrder: 3, photoLimit: null, tickedByDefault: true, kind: "marketplace" },
  { key: "classic_com", name: "classic.com", sortOrder: 4, photoLimit: null, tickedByDefault: false, kind: "marketplace" },
  { key: "autotrader_classics", name: "AutotraderClassics.com", sortOrder: 5, photoLimit: null, tickedByDefault: false, kind: "marketplace" },
  { key: "craigslist", name: "Craigslist", sortOrder: 6, photoLimit: 24, tickedByDefault: false, kind: "classified" },
  { key: "facebook_marketplace", name: "Facebook Marketplace", sortOrder: 7, photoLimit: 20, tickedByDefault: false, kind: "social" },
  { key: "facebook_page", name: "Facebook Dealer Page", sortOrder: 8, photoLimit: null, tickedByDefault: false, kind: "social" },
  { key: "facebook_groups", name: "Facebook Groups", sortOrder: 9, photoLimit: null, tickedByDefault: false, kind: "social" },
] as const;

export function channelDefaults(key: string) {
  return CHANNEL_DEFAULTS.find((c) => c.key === key);
}
export type ChannelKey = (typeof CHANNEL_DEFAULTS)[number]["key"];
export const CHANNEL_KEYS: string[] = CHANNEL_DEFAULTS.map((c) => c.key);

/** Website keeps sold cars up (sold pages stay live); marketplaces only carry cars for sale. */
export function channelCarries(channelKey: string, availability: Availability): boolean {
  if (channelKey === "website") return true;
  return availability !== "sold";
}

/** Creates the three channels on first use — no seed step needed in production. */
export async function ensureChannels() {
  const existing = await db.listingChannel.findMany();
  const have = new Set(existing.map((c) => c.key));
  for (const c of CHANNEL_DEFAULTS) {
    if (have.has(c.key)) continue;
    await db.listingChannel
      .create({ data: { key: c.key, name: c.name, sortOrder: c.sortOrder, feedToken: newFeedToken() } })
      .catch(() => {}); // a concurrent first request created it — fine
  }
  return db.listingChannel.findMany({ orderBy: { sortOrder: "asc" } });
}

export function newFeedToken() {
  return randomBytes(24).toString("base64url");
}

export function feedUrls(channel: { key: string; feedToken: string }) {
  const base = `${config().APP_URL.replace(/\/$/, "")}/api/listings/feed/${channel.key}`;
  const q = `token=${encodeURIComponent(channel.feedToken)}`;
  return { json: `${base}?${q}&format=json`, xml: `${base}?${q}&format=xml`, csv: `${base}?${q}&format=csv` };
}

export async function updateChannel(
  user: SessionUser,
  key: string,
  patch: { method?: "FEED" | "MANUAL"; enabled?: boolean; rotateToken?: boolean },
) {
  const before = await db.listingChannel.findUnique({ where: { key } });
  if (!before) throw new ListingError("That channel does not exist.");
  const updated = await db.listingChannel.update({
    where: { key },
    data: {
      method: patch.method ?? undefined,
      enabled: patch.enabled ?? undefined,
      feedToken: patch.rotateToken ? newFeedToken() : undefined,
    },
  });
  await audit(user, {
    action: "listing.channel.update",
    resourceType: "listing_channel",
    resourceId: key,
    previousValues: { method: before.method, enabled: before.enabled },
    newValues: { method: updated.method, enabled: updated.enabled, rotatedToken: Boolean(patch.rotateToken) },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// The listing itself
// ---------------------------------------------------------------------------

type VehicleForListing = {
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  bodyStyle: string | null;
  generalDescription: string | null;
  provenance: string | null;
  restorationHistory: string | null;
  originalityNotes: string | null;
  modifications: string | null;
};

export function defaultTitle(v: VehicleForListing): string {
  return [v.year, v.make, v.model, v.trim, v.bodyStyle].filter(Boolean).join(" ");
}

/** Starting text pulled from what intake already recorded, so nobody types it twice. */
export function prefillFromVehicle(v: VehicleForListing) {
  const history = [v.provenance, v.restorationHistory].filter((s) => s && s.trim()).join("\n\n") || null;
  const condition = [v.originalityNotes, v.modifications ? `Modifications: ${v.modifications}` : null]
    .filter((s) => s && s.trim())
    .join("\n\n") || null;
  return {
    title: defaultTitle(v),
    description: v.generalDescription?.trim() || null,
    history,
    condition,
  };
}

export async function getListing(episodeId: string) {
  return db.listing.findUnique({ where: { episodeId }, include: { publications: true } });
}

export async function startListing(user: SessionUser, episodeId: string) {
  const existing = await db.listing.findUnique({ where: { episodeId } });
  if (existing) return existing;
  const episode = await db.inventoryEpisode.findUnique({ where: { id: episodeId }, include: { vehicle: true } });
  if (!episode) throw new ListingError("That vehicle record no longer exists.");
  const listing = await db.listing.create({
    data: { episodeId, createdById: user.id, ...prefillFromVehicle(episode.vehicle) },
  });
  await audit(user, { action: "listing.create", resourceType: "listing", resourceId: listing.id, newValues: { episodeId } });
  return listing;
}

export interface ListingWriteup {
  title: string;
  headline?: string | null;
  highlights?: string[];
  description?: string | null;
  equipment?: string | null;
  history?: string | null;
  condition?: string | null;
  documentation?: string | null;
  priceDisplay?: "SHOW" | "CALL_FOR_PRICE";
  askingPrice?: number | null;
}

const TEXT_FIELDS = ["headline", "description", "equipment", "history", "condition", "documentation"] as const;

function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\r\n/g, "\n").trim();
  return t ? t : null;
}

export function cleanHighlights(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((l) => l.replace(/^[\s•\-*·]+/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

export async function saveListing(user: SessionUser, episodeId: string, input: ListingWriteup) {
  const listing = await startListing(user, episodeId);
  const title = input.title.trim();
  if (!title) throw new ListingError("Give the listing a title — usually year, make and model.");
  if (title.length > 120) throw new ListingError("Keep the title under 120 characters; platforms cut longer ones off.");

  const data: Prisma.ListingUpdateInput = { title, updatedById: user.id };
  const changed: string[] = [];
  if (title !== listing.title) changed.push("title");
  for (const f of TEXT_FIELDS) {
    if (input[f] === undefined) continue;
    const v = clean(input[f]);
    if (v !== listing[f]) changed.push(f);
    data[f] = v;
  }
  if (input.headline && input.headline.trim().length > 160) {
    throw new ListingError("Keep the headline to one line (160 characters or fewer).");
  }
  if (input.highlights !== undefined) {
    const h = cleanHighlights(input.highlights);
    if (JSON.stringify(h) !== JSON.stringify(listing.highlights)) changed.push("highlights");
    data.highlights = h;
  }
  if (input.priceDisplay && input.priceDisplay !== listing.priceDisplay) {
    changed.push("priceDisplay");
    data.priceDisplay = input.priceDisplay;
  }

  // Asking price stays on the episode (with its price history); the listing
  // just offers a convenient place to set it.
  if (input.askingPrice !== undefined && input.askingPrice !== null) {
    if (!(input.askingPrice > 0) || input.askingPrice > 50_000_000) {
      throw new ListingError("Enter the asking price as a number, like 79900.");
    }
    const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
    if (episode.askingPrice == null || Number(episode.askingPrice) !== input.askingPrice) {
      const { setAskingPrice } = await import("@/modules/episodes/service");
      await setAskingPrice(user, episodeId, input.askingPrice, "Set in the Listing Tool");
      changed.push("price");
    }
  }

  if (changed.length) data.contentVersion = { increment: 1 };
  const updated = await db.listing.update({ where: { id: listing.id }, data });
  if (changed.length) {
    await audit(user, {
      action: "listing.update",
      resourceType: "listing",
      resourceId: listing.id,
      newValues: { episodeId, changed },
    });
  }
  return { listing: updated, changed };
}

// ---------------------------------------------------------------------------
// Listing media
// ---------------------------------------------------------------------------

export async function listingMedia(episodeId: string) {
  const [photos, videoFiles, videoLinks] = await Promise.all([
    db.mediaAsset.findMany({
      where: { episodeId, purpose: "LISTING", kind: "PHOTO", archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.mediaAsset.findMany({
      where: { episodeId, purpose: "LISTING", kind: "VIDEO", archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.videoLink.findMany({
      where: { episodeId, purpose: "LISTING" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return { photos, videoFiles, videoLinks };
}

async function listingPhotosFor(episodeId: string) {
  return db.mediaAsset.findMany({
    where: { episodeId, purpose: "LISTING", kind: "PHOTO", archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
}

/** Saves a new photo order. The list must be exactly this listing's photos — no more, no fewer. */
export async function reorderListingPhotos(user: SessionUser, episodeId: string, orderedIds: string[]) {
  const current = await listingPhotosFor(episodeId);
  const currentIds = new Set(current.map((p) => p.id));
  if (orderedIds.length !== currentIds.size || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => currentIds.has(id))) {
    throw new ListingError("The photo list changed while you were arranging it — reload and try again.");
  }
  await db.$transaction(
    orderedIds.map((id, i) => db.mediaAsset.update({ where: { id }, data: { sortOrder: i + 1 } })),
  );
  await bumpListingVersion(episodeId);
  await audit(user, {
    action: "listing.photos.reorder",
    resourceType: "episode",
    resourceId: episodeId,
    newValues: { count: orderedIds.length, cover: orderedIds[0] },
  });
}

/** Moves one photo to the front — the cover every platform shows first. */
export async function setCoverPhoto(user: SessionUser, episodeId: string, assetId: string) {
  const current = await listingPhotosFor(episodeId);
  if (!current.some((p) => p.id === assetId)) throw new ListingError("That photo is not on this listing.");
  await reorderListingPhotos(user, episodeId, [assetId, ...current.map((p) => p.id).filter((id) => id !== assetId)]);
}

export async function removeListingMedia(user: SessionUser, assetId: string) {
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.purpose !== "LISTING") throw new ListingError("That is not a listing photo.");
  if (asset.archivedAt) return asset; // already removed — the desired state
  const updated = await db.mediaAsset.update({ where: { id: assetId }, data: { archivedAt: new Date() } });
  await bumpListingVersion(asset.episodeId);
  await audit(user, { action: "listing.media.remove", resourceType: "media", resourceId: assetId, previousValues: { episodeId: asset.episodeId, kind: asset.kind } });
  return updated;
}

/**
 * Adds chosen intake photos to the listing. The files are shared, not copied —
 * removing one from the listing leaves the intake record untouched.
 */
export async function copyIntakePhotosToListing(user: SessionUser, episodeId: string, assetIds: string[]) {
  if (assetIds.length === 0) throw new ListingError("Tick the intake photos to add first.");
  const sources = await db.mediaAsset.findMany({
    where: { id: { in: assetIds }, episodeId, purpose: "INTAKE", kind: "PHOTO", archivedAt: null },
    orderBy: { sortOrder: "asc" },
  });
  if (sources.length === 0) throw new ListingError("Those photos are no longer on this vehicle.");
  const current = await db.mediaAsset.count({ where: { episodeId, purpose: "LISTING", kind: "PHOTO", archivedAt: null } });
  const room = LISTING_PHOTO_LIMIT - current;
  if (room <= 0) throw new ListingError(`This listing already has ${LISTING_PHOTO_LIMIT} photos — the most a listing can carry.`);
  const take = sources.slice(0, room);
  const maxSort = await db.mediaAsset.aggregate({ where: { episodeId, purpose: "LISTING" }, _max: { sortOrder: true } });
  let sort = maxSort._max.sortOrder ?? 0;
  for (const s of take) {
    sort += 1;
    await db.mediaAsset.create({
      data: {
        episodeId,
        fileId: s.fileId,
        webFileId: s.webFileId,
        thumbFileId: s.thumbFileId,
        kind: "PHOTO",
        purpose: "LISTING",
        category: "listing",
        caption: s.caption,
        sortOrder: sort,
        uploadedById: user.id,
      },
    });
  }
  await bumpListingVersion(episodeId);
  await audit(user, {
    action: "listing.photos.copy_from_intake",
    resourceType: "episode",
    resourceId: episodeId,
    newValues: { added: take.length, skippedForLimit: sources.length - take.length },
  });
  return { added: take.length, skipped: sources.length - take.length };
}

// ---------------------------------------------------------------------------
// Readiness — what must be there before publishing, and what makes it better
// ---------------------------------------------------------------------------

export interface ListingCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
}

export function checkListing(input: {
  listing: Pick<Listing, "title" | "description" | "highlights" | "priceDisplay"> | null;
  askingPrice: number | null;
  photoCount: number;
  videoCount: number;
  hasVin: boolean;
  mileageStatus: string;
}): { checks: ListingCheck[]; canPublish: boolean } {
  const l = input.listing;
  const checks: ListingCheck[] = [
    { key: "title", label: "Title", ok: Boolean(l?.title.trim()), required: true },
    { key: "description", label: "Overview written", ok: (l?.description?.trim().length ?? 0) >= 40, required: true },
    {
      key: "price",
      label: "Asking price set (or “Call for price”)",
      ok: input.askingPrice != null || l?.priceDisplay === "CALL_FOR_PRICE",
      required: true,
    },
    { key: "photo", label: "At least one listing photo", ok: input.photoCount > 0, required: true },
    { key: "photos30", label: "30+ photos (buyers who can't visit want them all)", ok: input.photoCount >= 30, required: false },
    { key: "highlights", label: "Highlights listed", ok: (l?.highlights.length ?? 0) >= 3, required: false },
    { key: "video", label: "A walkaround or cold-start video", ok: input.videoCount > 0, required: false },
    { key: "vin", label: "VIN / chassis number recorded", ok: input.hasVin, required: false },
    { key: "mileage", label: "Odometer status known", ok: input.mileageStatus !== "UNKNOWN", required: false },
  ];
  return { checks, canPublish: checks.filter((c) => c.required).every((c) => c.ok) };
}

export async function listingCheckFor(episodeId: string) {
  const [episode, listing, media] = await Promise.all([
    db.inventoryEpisode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { vehicle: { include: { identifiers: { where: { isPrimary: true } } } } },
    }),
    db.listing.findUnique({ where: { episodeId } }),
    listingMedia(episodeId),
  ]);
  return checkListing({
    listing,
    askingPrice: episode.askingPrice != null ? Number(episode.askingPrice) : null,
    photoCount: media.photos.length,
    videoCount: media.videoFiles.length + media.videoLinks.length,
    hasVin: episode.vehicle.identifiers.length > 0,
    mileageStatus: episode.vehicle.mileageStatus,
  });
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/** Puts the listing on the chosen channels. Re-publishing a live channel is how an update is pushed by hand. */
export async function publishListing(user: SessionUser, episodeId: string, channelKeys: string[]) {
  const keys = [...new Set(channelKeys)].filter((k) => CHANNEL_KEYS.includes(k));
  if (keys.length === 0) throw new ListingError("Tick at least one place to publish to.");
  const listing = await db.listing.findUnique({ where: { episodeId } });
  if (!listing) throw new ListingError("Write the listing first — then publish it.");
  const { canPublish, checks } = await listingCheckFor(episodeId);
  if (!canPublish) {
    const missing = checks.filter((c) => c.required && !c.ok).map((c) => c.label.toLowerCase());
    throw new ListingError(`Not ready to publish yet — still needs: ${missing.join(", ")}.`);
  }
  const channels = await ensureChannels();
  const disabled = keys.filter((k) => !channels.find((c) => c.key === k)?.enabled);
  if (disabled.length) {
    throw new ListingError(`${disabled.map((k) => channels.find((c) => c.key === k)?.name ?? k).join(", ")} is switched off in Listing channels.`);
  }

  const ep = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  const availability = availabilityFor(ep.salesStatus, ep.active);
  const refused = keys.filter((k) => !channelCarries(k, availability));
  if (refused.length) {
    throw new ListingError(
      `This car is sold — ${refused.map((k) => channels.find((c) => c.key === k)?.name ?? k).join(" and ")} only carry cars for sale. Our website keeps sold cars up.`,
    );
  }

  const { emitIntegrationEvent } = await import("@/modules/media/service");
  const now = new Date();
  for (const key of keys) {
    const existing = await db.listingPublication.findUnique({ where: { listingId_channelKey: { listingId: listing.id, channelKey: key } } });
    // A live listing stays LIVE (the feed simply carries the newer version);
    // anything else goes in the queue.
    const status = existing?.status === "LIVE" ? "LIVE" : "QUEUED";
    await db.listingPublication.upsert({
      where: { listingId_channelKey: { listingId: listing.id, channelKey: key } },
      update: { status, queuedAt: status === "QUEUED" ? now : existing?.queuedAt, removedAt: null, updatedById: user.id },
      create: { listingId: listing.id, channelKey: key, status: "QUEUED", queuedAt: now, updatedById: user.id },
    });
    await emitIntegrationEvent("listing.publish", episodeId, { listingId: listing.id, channel: key, version: listing.contentVersion });
  }

  const episode = await db.inventoryEpisode.findUniqueOrThrow({ where: { id: episodeId } });
  if (!["SUBMITTED_TO_LISTING_SYSTEM", "LIVE", "MARKED_SOLD"].includes(episode.marketingStatus)) {
    const { changeEpisodeStatus } = await import("@/modules/episodes/service");
    await changeEpisodeStatus(user, episodeId, "marketing", "SUBMITTED_TO_LISTING_SYSTEM", "Published from the Listing Tool");
  }
  await audit(user, { action: "listing.publish", resourceType: "listing", resourceId: listing.id, newValues: { channels: keys, version: listing.contentVersion } });
}

/** Takes the listing off one channel. A feed drops it at the next pickup; a manual channel needs removing by hand. */
export async function unpublishListing(user: SessionUser, episodeId: string, channelKey: string) {
  const listing = await db.listing.findUnique({ where: { episodeId } });
  if (!listing) return;
  const pub = await db.listingPublication.findUnique({ where: { listingId_channelKey: { listingId: listing.id, channelKey } } });
  if (!pub || pub.status === "OFF") return;
  const channel = await db.listingChannel.findUnique({ where: { key: channelKey } });
  // Never delivered, or no feed to drop it from → nothing left to wait for.
  const immediate = pub.status === "QUEUED" || channel?.method !== "FEED";
  await db.listingPublication.update({
    where: { id: pub.id },
    data: { status: immediate ? "OFF" : "REMOVING", removedAt: immediate ? new Date() : null, updatedById: user.id },
  });
  const { emitIntegrationEvent } = await import("@/modules/media/service");
  await emitIntegrationEvent("listing.unpublish", episodeId, { listingId: listing.id, channel: channelKey, at: Date.now() });
  await audit(user, { action: "listing.unpublish", resourceType: "listing", resourceId: listing.id, newValues: { channel: channelKey } });
}

/** Staff confirm a hand-posted listing (or a posted update) is up, optionally with its link. */
export async function markPublicationLive(user: SessionUser, episodeId: string, channelKey: string, externalUrl?: string | null) {
  const listing = await db.listing.findUnique({ where: { episodeId } });
  if (!listing) throw new ListingError("Write the listing first.");
  let url: string | null = null;
  if (externalUrl && externalUrl.trim()) {
    try {
      const parsed = new URL(externalUrl.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
      url = parsed.toString();
    } catch {
      throw new ListingError("That does not look like a link — paste the full address of the live listing.");
    }
  }
  const now = new Date();
  const pub = await db.listingPublication.upsert({
    where: { listingId_channelKey: { listingId: listing.id, channelKey } },
    update: {
      status: "LIVE",
      deliveredVersion: listing.contentVersion,
      lastDeliveredAt: now,
      liveAt: now,
      externalUrl: url ?? undefined,
      updatedById: user.id,
    },
    create: {
      listingId: listing.id,
      channelKey,
      status: "LIVE",
      deliveredVersion: listing.contentVersion,
      lastDeliveredAt: now,
      liveAt: now,
      externalUrl: url,
      updatedById: user.id,
    },
  });
  await markEpisodeLive(episodeId, user.id);
  await audit(user, { action: "listing.mark_live", resourceType: "listing", resourceId: listing.id, newValues: { channel: channelKey, url } });
  return pub;
}

/** First time a car is live anywhere: marketing → LIVE and firstListedAt stamped. */
async function markEpisodeLive(episodeId: string, changedBy: string | null) {
  const episode = await db.inventoryEpisode.findUnique({ where: { id: episodeId } });
  if (!episode || ["LIVE", "MARKED_SOLD"].includes(episode.marketingStatus)) return;
  await db.inventoryEpisode.update({
    where: { id: episodeId },
    data: { marketingStatus: "LIVE", firstListedAt: episode.firstListedAt ?? new Date() },
  });
  await db.statusChange.create({
    data: { episodeId, dimension: "marketing", fromValue: episode.marketingStatus, toValue: "LIVE", reason: "Listing went live", changedBy },
  });
}

// ---------------------------------------------------------------------------
// Feed building + pickup
// ---------------------------------------------------------------------------

export function dealerInfo(): FeedDealer {
  return { ...DEALER, phone: config().DEALER_PHONE ?? DEALER_PHONE };
}

export function publicMediaUrl(assetId: string, size: "large" | "thumb" = "large") {
  return `${config().APP_URL.replace(/\/$/, "")}/api/listings/media/${assetId}${size === "thumb" ? "?size=thumb" : ""}`;
}

type ListingWithEverything = Listing & {
  publications: ListingPublication[];
};

export function toFeedListing(input: {
  listing: ListingWithEverything;
  episode: {
    stockNumber: string;
    askingPrice: Prisma.Decimal | number | null;
    salesStatus: string;
    active: boolean;
  };
  vehicle: {
    year: number | null;
    make: string;
    model: string;
    trim: string | null;
    bodyStyle: string | null;
    exteriorColor: string | null;
    interiorColor: string | null;
    engineDescription: string | null;
    transmission: string | null;
    drivetrain: string | null;
    mileage: number | null;
    mileageStatus: string;
  };
  vin: string | null;
  photos: Pick<MediaAsset, "id" | "caption">[];
  videoFiles: Pick<MediaAsset, "id" | "caption">[];
  videoLinks: Pick<VideoLink, "url" | "label">[];
}): FeedListing {
  const { listing: l, episode, vehicle: v } = input;
  const call = l.priceDisplay === "CALL_FOR_PRICE";
  const price = episode.askingPrice != null ? Number(episode.askingPrice) : null;
  const sections = [
    { heading: "Overview", body: l.description },
    { heading: "Equipment & options", body: l.equipment },
    { heading: "History & provenance", body: l.history },
    { heading: "Condition", body: l.condition },
    { heading: "Documentation & records", body: l.documentation },
  ].filter((s): s is { heading: string; body: string } => Boolean(s.body && s.body.trim()));
  const composed = composeDescription({ headline: l.headline, highlights: l.highlights, sections });
  return {
    id: l.id,
    stockNumber: episode.stockNumber,
    vin: input.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim,
    bodyStyle: v.bodyStyle,
    exteriorColor: v.exteriorColor,
    interiorColor: v.interiorColor,
    engine: v.engineDescription,
    transmission: v.transmission,
    drivetrain: v.drivetrain,
    mileage: v.mileageStatus === "EXEMPT" && v.mileage == null ? null : v.mileage,
    mileageNote: mileageNoteFor(v.mileageStatus),
    price: call ? null : price,
    priceLabel: formatPrice(price, call),
    availability: availabilityFor(episode.salesStatus, episode.active),
    title: l.title,
    headline: l.headline,
    highlights: l.highlights,
    sections,
    descriptionText: composed.text,
    descriptionHtml: composed.html,
    photos: input.photos.map((p, i) => ({
      url: publicMediaUrl(p.id),
      thumbUrl: publicMediaUrl(p.id, "thumb"),
      caption: p.caption,
      position: i + 1,
    })),
    videos: [
      ...input.videoLinks.map((vl) => ({ url: vl.url, kind: videoKind(vl.url), label: vl.label })),
      ...input.videoFiles.map((vf) => ({ url: publicMediaUrl(vf.id), kind: "file" as const, label: vf.caption })),
    ],
    updatedAt: l.updatedAt.toISOString(),
    version: l.contentVersion,
  };
}

/** Everything one channel should carry right now. */
export async function feedForChannel(channelKey: string): Promise<{ listings: FeedListing[]; publicationIds: string[] }> {
  const pubs = await db.listingPublication.findMany({
    where: { channelKey, status: { in: ["QUEUED", "LIVE"] } },
    include: { listing: { include: { publications: true } } },
  });
  if (pubs.length === 0) return { listings: [], publicationIds: [] };
  const episodeIds = pubs.map((p) => p.listing.episodeId);
  const [episodes, photos, videoFiles, videoLinks] = await Promise.all([
    db.inventoryEpisode.findMany({
      where: { id: { in: episodeIds } },
      include: { vehicle: { include: { identifiers: { where: { isPrimary: true } } } } },
    }),
    db.mediaAsset.findMany({
      where: { episodeId: { in: episodeIds }, purpose: "LISTING", kind: "PHOTO", archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, caption: true, episodeId: true },
    }),
    db.mediaAsset.findMany({
      where: { episodeId: { in: episodeIds }, purpose: "LISTING", kind: "VIDEO", archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, caption: true, episodeId: true },
    }),
    db.videoLink.findMany({
      where: { episodeId: { in: episodeIds }, purpose: "LISTING" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const byEpisode = new Map(episodes.map((e) => [e.id, e]));
  const listings: FeedListing[] = [];
  const publicationIds: string[] = [];
  for (const pub of pubs) {
    const e = byEpisode.get(pub.listing.episodeId);
    if (!e) continue;
    const feed = toFeedListing({
      listing: pub.listing,
      episode: e,
      vehicle: e.vehicle,
      vin: e.vehicle.identifiers[0]?.value ?? null,
      photos: photos.filter((p) => p.episodeId === e.id),
      videoFiles: videoFiles.filter((p) => p.episodeId === e.id),
      videoLinks: videoLinks.filter((p) => p.episodeId === e.id),
    });
    if (!channelCarries(channelKey, feed.availability)) continue;
    if (feed.photos.length === 0) continue; // every platform rejects a listing with no photos
    listings.push(feed);
    publicationIds.push(pub.id);
  }
  listings.sort((a, b) => a.stockNumber.localeCompare(b.stockNumber));
  return { listings, publicationIds };
}

/**
 * A channel fetched its feed. Whatever was in it is now delivered (QUEUED →
 * LIVE, version recorded); whatever it used to carry but no longer does
 * (removed, or sold off a marketplace) is now OFF.
 */
export async function recordFeedPickup(channelKey: string, delivered: { publicationIds: string[]; listings: FeedListing[] }, from: string | null) {
  const now = new Date();
  await db.listingChannel.update({ where: { key: channelKey }, data: { lastFetchAt: now, lastFetchFrom: from?.slice(0, 200) ?? null } });
  const versionByListing = new Map(delivered.listings.map((l) => [l.id, l.version]));
  const included = await db.listingPublication.findMany({ where: { id: { in: delivered.publicationIds } } });
  for (const pub of included) {
    const wasQueued = pub.status === "QUEUED";
    await db.listingPublication.update({
      where: { id: pub.id },
      data: {
        status: "LIVE",
        deliveredVersion: versionByListing.get(pub.listingId) ?? pub.deliveredVersion,
        lastDeliveredAt: now,
        liveAt: wasQueued ? now : pub.liveAt,
      },
    });
    if (wasQueued) {
      const listing = await db.listing.findUnique({ where: { id: pub.listingId }, select: { episodeId: true } });
      if (listing) await markEpisodeLive(listing.episodeId, null);
    }
  }
  await db.listingPublication.updateMany({
    where: { channelKey, status: { in: ["LIVE", "REMOVING"] }, id: { notIn: delivered.publicationIds } },
    data: { status: "OFF", removedAt: now },
  });
  await audit(null, {
    action: "listing.feed_pickup",
    resourceType: "listing_channel",
    resourceId: channelKey,
    newValues: { listings: delivered.publicationIds.length },
    source: "integration",
    integration: channelKey,
  });
}

// ---------------------------------------------------------------------------
// Summaries for the pages
// ---------------------------------------------------------------------------

export type PublicationView = {
  channelKey: string;
  channelName: string;
  method: "FEED" | "MANUAL";
  enabled: boolean;
  status: "QUEUED" | "LIVE" | "REMOVING" | "OFF";
  /** Live, but holding an older version than the listing now has. */
  behind: boolean;
  /** Sold, and a hand-posted marketplace listing is still up. */
  needsTakedown: boolean;
  externalUrl: string | null;
  liveAt: Date | null;
  lastDeliveredAt: Date | null;
  /** Pre-ticked in the Publish box. */
  tickedByDefault: boolean;
};

export function publicationViews(
  channels: { key: string; name: string; method: "FEED" | "MANUAL"; enabled: boolean }[],
  listing: (Listing & { publications: ListingPublication[] }) | null,
  availability: Availability,
): PublicationView[] {
  return channels.map((c) => {
    const pub = listing?.publications.find((p) => p.channelKey === c.key);
    const status = pub?.status ?? "OFF";
    return {
      channelKey: c.key,
      channelName: c.name,
      method: c.method,
      enabled: c.enabled,
      status,
      behind: status === "LIVE" && listing != null && (pub?.deliveredVersion ?? 0) < listing.contentVersion,
      needsTakedown: status === "LIVE" && c.method === "MANUAL" && !channelCarries(c.key, availability),
      externalUrl: pub?.externalUrl ?? null,
      liveAt: pub?.liveAt ?? null,
      lastDeliveredAt: pub?.lastDeliveredAt ?? null,
      tickedByDefault: channelDefaults(c.key)?.tickedByDefault ?? false,
    };
  });
}

export { vehicleLabel };
