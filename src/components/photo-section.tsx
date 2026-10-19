/**
 * The Intake Photos card on vehicle and episode pages: the condition record
 * taken when a car arrives (gallery grid, direct-to-storage uploader, video
 * links). Kept for the dealership's files and never published — the photos
 * buyers see are chosen separately in the Listing Tool. Server component —
 * fetches the assets and renders the interactive pieces as client islands.
 */
import Link from "next/link";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { archiveMediaAssetAction, removeVideoLinkAction } from "@/modules/media/actions";
import { AddVideoLinkForm, PhotoUploader } from "@/components/vehicle-photos";
import { Card } from "@/components/ui";

export async function PhotoSection({ user, episodeId }: { user: SessionUser; episodeId: string }) {
  if (!hasPermission(user, "media", "view")) return null;
  const [photos, videoLinks] = await Promise.all([
    db.mediaAsset.findMany({
      where: { episodeId, kind: "PHOTO", purpose: "INTAKE", archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    db.videoLink.findMany({ where: { episodeId, purpose: "INTAKE" }, orderBy: { createdAt: "asc" } }),
  ]);
  const canSeeListing = hasPermission(user, "listings", "view");
  const canUpload = hasPermission(user, "media", "create");
  const canEdit = hasPermission(user, "media", "edit");

  return (
    <Card accent="teal">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900">Intake Photos</h2>
        <span className="text-xs text-stone-500">
          {photos.length === 0 ? "None yet" : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <p className="mb-3 text-xs text-stone-500">
        The condition record from when the car came in — damage, VIN plates, odometer, paperwork. For our files only;
        these are <strong className="font-semibold text-stone-700">not</strong> used for the listing.
        {canSeeListing ? (
          <>
            {" "}
            Photos for buyers go in the{" "}
            <Link href={`/listings/${episodeId}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">
              Listing Tool
            </Link>
            .
          </>
        ) : null}
      </p>

      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((p) => (
            <li key={p.id} className="group relative overflow-hidden rounded-md border border-stone-200">
              <a
                href={`/api/files/${p.webFileId ?? p.fileId}`}
                target="_blank"
                rel="noreferrer"
                title={p.caption ?? "Open full size"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${p.thumbFileId ?? p.fileId}`}
                  alt={p.caption ?? "Intake photo"}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </a>
              {canEdit ? (
                <form action={archiveMediaAssetAction} className="absolute right-1 top-1">
                  <input type="hidden" name="assetId" value={p.id} />
                  <button
                    type="submit"
                    aria-label="Remove photo"
                    className="rounded-full bg-black/55 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                  >
                    ✕
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">
          No photos yet{canUpload ? " — add them straight from a phone at intake." : "."}
        </p>
      )}

      {canUpload ? (
        <div className="mt-3">
          <PhotoUploader episodeId={episodeId} buttonLabel="Add intake photos" />
          <p className="mt-1 text-xs text-stone-500">
            Photos upload straight to storage and are resized automatically — originals are kept.
          </p>
        </div>
      ) : null}

      <div className="mt-5 border-t border-stone-200 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Intake videos</h3>
        {videoLinks.length > 0 ? (
          <ul className="mb-3 space-y-1">
            {videoLinks.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                <a
                  href={v.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  {v.label || new URL(v.url).host}
                </a>
                {canEdit ? (
                  <form action={removeVideoLinkAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="episodeId" value={episodeId} />
                    <button type="submit" className="text-xs text-stone-400 hover:text-red-700">
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-stone-500">
            No intake video links. For a condition video (cold start, noises), paste a Google Photos or YouTube link
            here. Videos for buyers go in the Listing Tool.
          </p>
        )}
        {canUpload ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Add a video link</summary>
            <div className="mt-2 max-w-md">
              <AddVideoLinkForm episodeId={episodeId} />
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
