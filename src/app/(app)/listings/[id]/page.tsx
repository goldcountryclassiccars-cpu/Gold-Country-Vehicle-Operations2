import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorize, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { LISTING_PHOTO_LIMIT } from "@/modules/media/service";
import {
  checkListing,
  ensureChannels,
  listingMedia,
  publicationViews,
  vehicleLabel,
} from "@/modules/listings/service";
import { availabilityFor, formatPrice } from "@/modules/listings/feed";
import { startListingAction } from "@/modules/listings/actions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { PhotoUploader } from "@/components/vehicle-photos";
import { WriteupForm } from "./writeup-form";
import { ListingPhotoGrid, CopyIntakePhotos } from "./listing-photos";
import { ListingVideos } from "./listing-videos";
import { PublishPanel } from "./publish-panel";

export const metadata: Metadata = { title: "Listing" };

const AVAILABILITY_LABEL = { available: "For sale", pending: "Sale pending", sold: "Sold" } as const;

export default async function ListingToolPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "listings");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const episode = await db.inventoryEpisode.findUnique({
    where: { id },
    include: { vehicle: { include: { identifiers: { where: { isPrimary: true } } } } },
  });
  if (!episode) notFound();
  const assigned = [episode.salespersonId, episode.operationsOwnerId].filter(Boolean) as string[];
  if (!authorize(user, "view", "episodes", { assignedUserIds: assigned })) notFound();

  const [listing, media, channels, intakePhotos] = await Promise.all([
    db.listing.findUnique({ where: { episodeId: id }, include: { publications: true } }),
    listingMedia(id),
    ensureChannels(),
    db.mediaAsset.findMany({
      where: { episodeId: id, purpose: "INTAKE", kind: "PHOTO", archivedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, fileId: true, thumbFileId: true, caption: true },
    }),
  ]);

  const canCreate = hasPermission(user, "listings", "create");
  const canEdit = hasPermission(user, "listings", "edit");
  const canPublish = hasPermission(user, "listings", "generate");
  const canConfigure = hasPermission(user, "listings", "manage_config");
  const v = episode.vehicle;
  const askingPrice = episode.askingPrice != null ? Number(episode.askingPrice) : null;
  const availability = availabilityFor(episode.salesStatus, episode.active);
  const check = checkListing({
    listing,
    askingPrice,
    photoCount: media.photos.length,
    videoCount: media.videoFiles.length + media.videoLinks.length,
    hasVin: v.identifiers.length > 0,
    mileageStatus: v.mileageStatus,
  });
  const pubs = publicationViews(channels, listing, availability);
  const remaining = LISTING_PHOTO_LIMIT - media.photos.length;

  return (
    <div className="mx-auto max-w-6xl pb-24">
      <PageHeader
        title={listing?.title || vehicleLabel(v)}
        subtitle={`${episode.stockNumber} · ${listing ? formatPrice(askingPrice, listing.priceDisplay === "CALL_FOR_PRICE") : askingPrice ? formatPrice(askingPrice, false) : "No price yet"}`}
        badge={<Badge tone={availability === "sold" ? "neutral" : availability === "pending" ? "amber" : "green"}>{AVAILABILITY_LABEL[availability]}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/episodes/${episode.id}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
              Vehicle file
            </Link>
            {listing ? (
              <Link
                href={`/listings/${episode.id}/kit`}
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
              >
                Preview &amp; posting kit
              </Link>
            ) : null}
          </div>
        }
      />

      {!listing ? (
        <Card accent="amber" className="mb-6">
          <h2 className="text-base font-semibold text-stone-900">No listing yet</h2>
          <p className="mt-1 text-sm text-stone-600">
            Start one and the title, overview, history and condition notes are filled in from what intake already recorded —
            then write it up, add the listing photos and videos, and publish to our website, Hemmings and ClassicCars.com.
          </p>
          {canCreate ? (
            <form action={startListingAction} className="mt-3">
              <input type="hidden" name="episodeId" value={episode.id} />
              <button type="submit" className="min-h-11 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                Start the listing
              </button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-stone-500">The office starts listings; you can still add photos below.</p>
          )}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Photos first: they are what a remote buyer judges the car by, and
            * the shop can work on them before the write-up exists. */}
          <Card accent="amber">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-stone-900">Listing photos</h2>
              <span className={`text-sm font-medium ${remaining <= 0 ? "text-red-700" : "text-stone-600"}`}>
                {media.photos.length} / {LISTING_PHOTO_LIMIT}
              </span>
            </div>
            <p className="mb-3 text-xs text-stone-500">
              The photos buyers see, in the order they see them — the first is the cover on every site. Separate from the
              Intake Photos.{canEdit ? " Tap a photo to move it, make it the cover or remove it; on a computer you can also drag." : ""}
            </p>
            <ListingPhotoGrid
              episodeId={episode.id}
              canEdit={canEdit}
              photos={media.photos.map((p) => ({
                id: p.id,
                thumbUrl: `/api/files/${p.thumbFileId ?? p.webFileId ?? p.fileId}`,
                fullUrl: `/api/files/${p.largeFileId ?? p.webFileId ?? p.fileId}`,
                caption: p.caption,
                platformReady: Boolean(p.largeFileId || p.webFileId),
              }))}
            />
            {canCreate ? (
              <div className="mt-4 space-y-3">
                <PhotoUploader
                  episodeId={episode.id}
                  purpose="LISTING"
                  remaining={remaining}
                  buttonLabel={media.photos.length ? "Add more listing photos" : "Add listing photos"}
                />
                <p className="text-xs text-stone-500">
                  Pick as many as you like at once (up to {LISTING_PHOTO_LIMIT} per listing). Each one is saved full size, plus a
                  2400px copy for the platforms.
                </p>
                {intakePhotos.length > 0 && remaining > 0 ? (
                  <CopyIntakePhotos
                    episodeId={episode.id}
                    photos={intakePhotos.map((p) => ({ id: p.id, thumbUrl: `/api/files/${p.thumbFileId ?? p.fileId}`, caption: p.caption }))}
                  />
                ) : null}
              </div>
            ) : null}
          </Card>

          {listing ? (
            <Card accent="brand">
              <h2 className="mb-1 text-base font-semibold text-stone-900">Write-up</h2>
              <p className="mb-4 text-xs text-stone-500">
                Specs, VIN and mileage come from the{" "}
                <Link href={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
                  vehicle record
                </Link>{" "}
                — fix them there and every listing updates.
              </p>
              <WriteupForm
                episodeId={episode.id}
                canEdit={canEdit}
                initial={{
                  title: listing.title,
                  headline: listing.headline ?? "",
                  highlights: listing.highlights.join("\n"),
                  description: listing.description ?? "",
                  equipment: listing.equipment ?? "",
                  history: listing.history ?? "",
                  condition: listing.condition ?? "",
                  documentation: listing.documentation ?? "",
                  priceDisplay: listing.priceDisplay,
                  askingPrice: askingPrice != null ? String(askingPrice) : "",
                }}
              />
            </Card>
          ) : null}

          <Card accent="violet">
            <h2 className="mb-1 text-base font-semibold text-stone-900">Listing videos</h2>
            <p className="mb-3 text-xs text-stone-500">
              A YouTube link is what Hemmings and ClassicCars.com can show; an uploaded file plays on our website. Add both if
              you have them.
            </p>
            <ListingVideos
              episodeId={episode.id}
              canAdd={canCreate}
              canEdit={canEdit}
              files={media.videoFiles.map((f) => ({ id: f.id, url: `/api/files/${f.fileId}`, caption: f.caption }))}
              links={media.videoLinks.map((l) => ({ id: l.id, url: l.url, label: l.label }))}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card accent={check.canPublish ? "green" : "amber"}>
            <h2 className="mb-2 text-base font-semibold text-stone-900">Ready to publish?</h2>
            <ul className="space-y-1.5">
              {check.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <span aria-hidden="true" className={c.ok ? "text-emerald-600" : c.required ? "text-red-600" : "text-stone-300"}>
                    {c.ok ? "✓" : c.required ? "✕" : "○"}
                  </span>
                  <span className={c.ok ? "text-stone-700" : c.required ? "text-stone-900" : "text-stone-500"}>
                    {c.label}
                    {!c.required && !c.ok ? <span className="text-xs text-stone-400"> — recommended</span> : null}
                    {c.required && !c.ok ? <span className="sr-only"> — required</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card accent="teal">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-900">Publish</h2>
              {canConfigure ? (
                <Link href="/listings/channels" className="text-xs font-medium text-brand-700 hover:underline">
                  Channel settings
                </Link>
              ) : null}
            </div>
            <PublishPanel
              episodeId={episode.id}
              hasListing={Boolean(listing)}
              canPublish={canPublish}
              ready={check.canPublish}
              availability={availability}
              publications={pubs.map((p) => ({
                ...p,
                liveAt: p.liveAt?.toISOString() ?? null,
                lastDeliveredAt: p.lastDeliveredAt?.toISOString() ?? null,
              }))}
            />
          </Card>

          <Card>
            <h2 className="mb-2 text-base font-semibold text-stone-900">From the vehicle record</h2>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
              {[
                ["Year", v.year],
                ["Make", v.make],
                ["Model", v.model],
                ["Trim", v.trim],
                ["Body", v.bodyStyle],
                ["Exterior", v.exteriorColor],
                ["Interior", v.interiorColor],
                ["Engine", v.engineDescription],
                ["Transmission", v.transmission],
                ["Drivetrain", v.drivetrain],
                ["Mileage", v.mileage != null ? `${v.mileage.toLocaleString()} (${v.mileageStatus.toLowerCase().replace(/_/g, " ")})` : v.mileageStatus.toLowerCase().replace(/_/g, " ")],
                ["VIN / chassis", v.identifiers[0]?.value],
              ].map(([label, value]) => (
                <div key={String(label)} className="contents">
                  <dt className="text-stone-500">{label}</dt>
                  <dd className={value ? "text-stone-900" : "text-stone-400"}>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
