import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { channelDefaults, dealerInfo, listingMedia, toFeedListing } from "@/modules/listings/service";
import { Card, PageHeader } from "@/components/ui";
import { CopyBlock, DownloadPhotos } from "./kit-tools";

export const metadata: Metadata = { title: "Preview & posting kit" };

/**
 * What a buyer will see, plus everything needed to post the car by hand on a
 * platform with no feed set up yet: copy-ready text and every photo, in order,
 * in one download.
 */
export default async function ListingKitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "listings");
  const { id } = await params;
  const { channel } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [episode, listing, media] = await Promise.all([
    db.inventoryEpisode.findUnique({
      where: { id },
      include: { vehicle: { include: { identifiers: { where: { isPrimary: true } } } } },
    }),
    db.listing.findUnique({ where: { episodeId: id }, include: { publications: true } }),
    listingMedia(id),
  ]);
  if (!episode || !listing) notFound();

  const feed = toFeedListing({
    listing,
    episode,
    vehicle: episode.vehicle,
    vin: episode.vehicle.identifiers[0]?.value ?? null,
    photos: media.photos,
    videoFiles: media.videoFiles,
    videoLinks: media.videoLinks,
  });
  // In the app, show photos through the signed-in file route (works before publishing).
  const photos = media.photos.map((p) => ({
    url: `/api/files/${p.largeFileId ?? p.webFileId ?? p.fileId}`,
    thumb: `/api/files/${p.thumbFileId ?? p.webFileId ?? p.fileId}`,
    caption: p.caption,
  }));
  const specs: [string, string | number | null][] = [
    ["Year", feed.year],
    ["Make", feed.make],
    ["Model", feed.model],
    ["Trim", feed.trim],
    ["Body style", feed.bodyStyle],
    ["Exterior color", feed.exteriorColor],
    ["Interior color", feed.interiorColor],
    ["Engine", feed.engine],
    ["Transmission", feed.transmission],
    ["Drivetrain", feed.drivetrain],
    ["Mileage", feed.mileage != null ? `${feed.mileage.toLocaleString()}${feed.mileageNote ? ` (${feed.mileageNote})` : ""}` : feed.mileageNote],
    ["VIN / chassis", feed.vin],
    ["Stock number", feed.stockNumber],
  ];
  const specsText = specs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
  const youtube = feed.videos.find((v) => v.kind === "youtube")?.url ?? null;
  const ch = channel ? channelDefaults(channel) : undefined;
  const channelName = ch?.name;
  const photoLimit = ch?.photoLimit ?? null;
  const kitPhotos = photoLimit ? photos.slice(0, photoLimit) : photos;
  const social = ch?.kind === "social" || ch?.kind === "classified";
  const dealer = dealerInfo();
  // A short post for Facebook / Craigslist: what it is, the price, the best
  // points, and how to reach a person — the full write-up is too long there.
  const shortPost = [
    `${feed.title} — ${feed.priceLabel}`,
    feed.headline,
    feed.highlights.length ? feed.highlights.map((h) => `✔ ${h}`).join("\n") : null,
    feed.mileage != null ? `${feed.mileage.toLocaleString()} miles${feed.mileageNote ? ` (${feed.mileageNote})` : ""}` : null,
    `Call or text ${dealer.phone} · ${dealer.name}, ${dealer.address}, ${dealer.city}, ${dealer.state}`,
    `More photos and details: ${dealer.website}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const fileBase = `${feed.stockNumber}-${[feed.year, feed.make, feed.model].filter(Boolean).join("-")}`.replace(/[^\w-]+/g, "-");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Preview & posting kit"
        subtitle={channelName ? `Everything needed to post this car on ${channelName}.` : "How the listing reads, and everything needed to post it by hand."}
        actions={
          <Link href={`/listings/${id}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
            ← Back to the listing
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Preview — as buyers will read it</p>
            {photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photos[0].url} alt={feed.title} className="mt-3 aspect-[3/2] w-full rounded-md bg-stone-100 object-cover" />
            ) : (
              <div className="mt-3 flex aspect-[3/2] w-full items-center justify-center rounded-md bg-stone-100 text-sm text-stone-400">No photos yet</div>
            )}
            {photos.length > 1 ? (
              <ul className="mt-2 flex gap-1 overflow-x-auto pb-1">
                {photos.slice(1, 13).map((p, i) => (
                  <li key={i} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt="" className="h-14 w-20 rounded object-cover" loading="lazy" />
                  </li>
                ))}
                {photos.length > 13 ? <li className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-stone-100 text-xs text-stone-500">+{photos.length - 13}</li> : null}
              </ul>
            ) : null}
            <h2 className="mt-4 text-xl font-semibold text-stone-900">{feed.title}</h2>
            {feed.headline ? <p className="mt-1 text-stone-600">{feed.headline}</p> : null}
            <p className="mt-2 text-2xl font-semibold text-brand-800">{feed.priceLabel}</p>
            {feed.highlights.length ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-stone-800">
                {feed.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            ) : null}
            {feed.sections.map((s) => (
              <section key={s.heading} className="mt-5">
                {s.heading !== "Overview" ? <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-700">{s.heading}</h3> : null}
                {s.body.split(/\n\s*\n/).map((para, i) => (
                  <p key={i} className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-800">{para}</p>
                ))}
              </section>
            ))}
            <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-stone-200 pt-4 text-sm sm:grid-cols-2">
              {specs.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-stone-100 py-1">
                  <dt className="text-stone-500">{k}</dt>
                  <dd className="text-right text-stone-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card accent="teal">
            <h2 className="mb-3 text-base font-semibold text-stone-900">Posting kit</h2>
            <div className="space-y-4">
              <DownloadPhotos photos={kitPhotos.map((p) => ({ url: p.url }))} fileBase={fileBase} />
              <p className="text-xs text-stone-500">
                Numbered in listing order, the cover first — upload them in that order.
                {photoLimit && photos.length > photoLimit
                  ? ` ${channelName} takes up to ${photoLimit} photos, so this downloads the first ${photoLimit}.`
                  : ""}
              </p>
              {social || !channelName ? <CopyBlock label="Short post (Facebook, Craigslist)" text={shortPost} rows={9} /> : null}
              <CopyBlock label="Title" text={feed.title} rows={2} />
              <CopyBlock label="Price" text={feed.price != null ? String(feed.price) : feed.priceLabel} rows={1} />
              <CopyBlock label="Description" text={feed.descriptionText} rows={12} />
              <CopyBlock label="Specifications" text={specsText} rows={8} />
              {youtube ? <CopyBlock label="YouTube video" text={youtube} rows={1} /> : null}
            </div>
          </Card>
          <p className="text-xs text-stone-500">
            When it&rsquo;s up, go back to the listing and press <strong>Mark live</strong> on that platform (paste its link if you
            have it) so the app knows it&rsquo;s there — and reminds you to take it down when the car sells.
          </p>
        </div>
      </div>
    </div>
  );
}
