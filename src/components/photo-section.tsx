/**
 * The Photos card on vehicle and episode pages: gallery grid, direct-to-storage
 * uploader, and video links. Server component — fetches the assets and renders
 * the interactive pieces (uploader, forms) as client islands.
 */
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
      where: { episodeId, kind: "PHOTO", archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    db.videoLink.findMany({ where: { episodeId }, orderBy: { createdAt: "asc" } }),
  ]);
  const canUpload = hasPermission(user, "media", "create");
  const canEdit = hasPermission(user, "media", "edit");

  return (
    <Card accent="teal">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900">Photos</h2>
        <span className="text-xs text-stone-500">
          {photos.length === 0 ? "None yet" : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}
        </span>
      </div>

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
                  alt={p.caption ?? "Vehicle photo"}
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
          No photos yet{canUpload ? " — add them straight from a phone." : "."}
        </p>
      )}

      {canUpload ? (
        <div className="mt-3">
          <PhotoUploader episodeId={episodeId} />
          <p className="mt-1 text-xs text-stone-500">
            Photos upload straight to storage and are resized automatically — originals are kept.
          </p>
        </div>
      ) : null}

      <div className="mt-5 border-t border-stone-200 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Videos</h3>
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
            No video links yet. Videos stay on Google Photos or YouTube — paste a link here so it lives with the car.
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
