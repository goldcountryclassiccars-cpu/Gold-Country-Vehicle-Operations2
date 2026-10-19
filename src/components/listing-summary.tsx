/**
 * The Listing card on vehicle and episode pages — sits right under Intake
 * Photos so the two are never confused: intake is the record, this is what
 * buyers see. One line of status and a way into the Listing Tool.
 */
import Link from "next/link";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { availabilityFor } from "@/modules/listings/feed";
import { ensureChannels, publicationViews } from "@/modules/listings/service";
import { LISTING_PHOTO_LIMIT } from "@/modules/media/service";
import { Badge, Card } from "@/components/ui";

export async function ListingSummary({ user, episodeId }: { user: SessionUser; episodeId: string }) {
  if (!hasPermission(user, "listings", "view")) return null;
  const [episode, listing, photos, videos, channels] = await Promise.all([
    db.inventoryEpisode.findUnique({ where: { id: episodeId }, select: { salesStatus: true, active: true } }),
    db.listing.findUnique({ where: { episodeId }, include: { publications: true } }),
    db.mediaAsset.count({ where: { episodeId, purpose: "LISTING", kind: "PHOTO", archivedAt: null } }),
    db.mediaAsset.count({ where: { episodeId, purpose: "LISTING", kind: "VIDEO", archivedAt: null } }),
    ensureChannels(),
  ]);
  if (!episode) return null;
  const linkCount = await db.videoLink.count({ where: { episodeId, purpose: "LISTING" } });
  const pubs = publicationViews(channels, listing, availabilityFor(episode.salesStatus, episode.active));
  const live = pubs.filter((p) => p.status === "LIVE");

  return (
    <Card accent="amber">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Listing</h2>
        <Link href={`/listings/${episodeId}`} className="min-h-10 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">
          {listing ? "Open the Listing Tool" : "Start the listing"}
        </Link>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        {listing ? listing.title : "Not written yet."} · {photos}/{LISTING_PHOTO_LIMIT} listing photos
        {videos + linkCount ? ` · ${videos + linkCount} video${videos + linkCount === 1 ? "" : "s"}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {pubs.filter((p) => p.status !== "OFF").map((p) => (
          <Badge key={p.channelKey} tone={p.needsTakedown ? "red" : p.status === "LIVE" ? "green" : p.status === "QUEUED" ? "blue" : "neutral"}>
            {p.channelName}: {p.needsTakedown ? "take down" : p.status === "LIVE" ? "live" : p.status === "QUEUED" ? "waiting" : p.status === "REMOVING" ? "coming down" : "not listed"}
          </Badge>
        ))}
      </div>
      {live.length === 0 && listing && pubs.every((p) => p.status === "OFF") ? (
        <p className="mt-2 text-xs text-stone-500">Not published anywhere yet.</p>
      ) : null}
    </Card>
  );
}
