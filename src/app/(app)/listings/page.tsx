import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { episodeWhereForUser } from "@/modules/episodes/service";
import { availabilityFor, formatPrice } from "@/modules/listings/feed";
import { ensureChannels, publicationViews, vehicleLabel } from "@/modules/listings/service";
import { LISTING_PHOTO_LIMIT } from "@/modules/media/service";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Listings" };

/**
 * The Listing Tool's front door: every car in inventory, how far its listing
 * has got, and anything that needs a person (a hand-posted listing to put up,
 * an update to post, a sold car still showing on a marketplace).
 */
export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "listings");
  const { show } = await searchParams;
  const showSold = show === "sold";

  const [episodes, channels] = await Promise.all([
    db.inventoryEpisode.findMany({
      where: {
        AND: [
          episodeWhereForUser(user),
          showSold
            ? { salesStatus: { in: ["CONTRACTED", "FUNDS_PENDING", "FUNDED", "READY_FOR_RELEASE", "RELEASED", "DELIVERED"] } }
            : { active: true },
        ],
      },
      include: { vehicle: true },
      orderBy: { stockNumber: "asc" },
      take: 200,
    }),
    ensureChannels(),
  ]);
  const ids = episodes.map((e) => e.id);
  const [listings, photoCounts, covers] = await Promise.all([
    db.listing.findMany({ where: { episodeId: { in: ids } }, include: { publications: true } }),
    db.mediaAsset.groupBy({
      by: ["episodeId"],
      where: { episodeId: { in: ids }, purpose: "LISTING", kind: "PHOTO", archivedAt: null },
      _count: true,
    }),
    db.mediaAsset.findMany({
      where: { episodeId: { in: ids }, purpose: "LISTING", kind: "PHOTO", archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      distinct: ["episodeId"],
      select: { episodeId: true, thumbFileId: true, webFileId: true, fileId: true },
    }),
  ]);
  const listingBy = new Map(listings.map((l) => [l.episodeId, l]));
  const countBy = new Map(photoCounts.map((p) => [p.episodeId, p._count]));
  const coverBy = new Map(covers.map((c) => [c.episodeId, c]));

  const rows = episodes.map((e) => {
    const listing = listingBy.get(e.id) ?? null;
    const availability = availabilityFor(e.salesStatus, e.active);
    const pubs = publicationViews(channels, listing, availability);
    const attention = [
      ...pubs.filter((p) => p.needsTakedown).map((p) => `Sold — take down on ${p.channelName}`),
      ...pubs.filter((p) => p.method === "MANUAL" && p.status === "QUEUED").map((p) => `Post on ${p.channelName}`),
      ...pubs.filter((p) => p.method === "MANUAL" && p.status === "LIVE" && p.behind && !p.needsTakedown).map((p) => `Update on ${p.channelName}`),
    ];
    return { e, listing, availability, pubs, attention, photos: countBy.get(e.id) ?? 0, cover: coverBy.get(e.id) };
  });
  rows.sort((a, b) => b.attention.length - a.attention.length || a.e.stockNumber.localeCompare(b.e.stockNumber));
  const needing = rows.filter((r) => r.attention.length).length;
  const canConfigure = hasPermission(user, "listings", "manage_config");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Listings"
        subtitle="Write each car up, choose its photos and videos, and publish to our website, Hemmings and ClassicCars.com."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={showSold ? "/listings" : "/listings?show=sold"}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
            >
              {showSold ? "In inventory" : "Sold"}
            </Link>
            {canConfigure ? (
              <Link href="/listings/channels" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
                Channel settings
              </Link>
            ) : null}
          </div>
        }
      />

      {needing > 0 ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {needing} listing{needing === 1 ? " needs" : "s need"} someone to do something — shown first.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={showSold ? "No sold cars to show" : "No cars in inventory"} />
      ) : (
        <ul className="space-y-3">
          {rows.map(({ e, listing, availability, pubs, attention, photos, cover }) => (
            <li key={e.id}>
              <Link
                href={`/listings/${e.id}`}
                className="flex gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm hover:border-brand-600"
              >
                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-stone-100">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${cover.thumbFileId ?? cover.webFileId ?? cover.fileId}`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-stone-400">No photos</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-stone-900">{listing?.title || vehicleLabel(e.vehicle)}</p>
                    <span className="text-sm text-stone-700">
                      {formatPrice(e.askingPrice != null ? Number(e.askingPrice) : null, listing?.priceDisplay === "CALL_FOR_PRICE")}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500">
                    {e.stockNumber} · {photos}/{LISTING_PHOTO_LIMIT} photos ·{" "}
                    {listing ? (listing.description ? "written" : "write-up started") : "no listing yet"}
                    {availability !== "available" ? ` · ${availability === "sold" ? "sold" : "sale pending"}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {pubs.map((p) => (
                      <Badge
                        key={p.channelKey}
                        tone={p.needsTakedown ? "red" : p.status === "LIVE" ? (p.behind ? "amber" : "green") : p.status === "QUEUED" ? "blue" : "neutral"}
                      >
                        {p.channelName}: {p.needsTakedown ? "take down" : p.status === "LIVE" ? (p.behind ? "update" : "live") : p.status === "QUEUED" ? "waiting" : p.status === "REMOVING" ? "coming down" : "—"}
                      </Badge>
                    ))}
                  </div>
                  {attention.length ? <p className="mt-1 text-xs font-medium text-amber-800">{attention.join(" · ")}</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
