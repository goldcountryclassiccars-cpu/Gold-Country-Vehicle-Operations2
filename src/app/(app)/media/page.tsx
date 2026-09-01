import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { mediaReadiness } from "@/modules/media/service";
import { archiveMediaAssetAction } from "@/modules/media/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Media" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ episode?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "media");
  const { episode: selectedId } = await searchParams;

  const episodes = await db.inventoryEpisode.findMany({
    where: { active: true },
    include: { vehicle: true },
    orderBy: { stockNumber: "asc" },
  });
  const readiness = await Promise.all(episodes.map(async (e) => ({ episode: e, media: await mediaReadiness(e.id) })));

  const selected = selectedId ? episodes.find((e) => e.id === selectedId) : null;
  const [selectedAssets, checklist] = selected
    ? await Promise.all([
        db.mediaAsset.findMany({ where: { episodeId: selected.id, archivedAt: null }, orderBy: { sortOrder: "asc" } }),
        db.mediaChecklistItem.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      ])
    : [[], []];

  const canUpload = hasPermission(user, "media", "create");
  const canEdit = hasPermission(user, "media", "edit");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Media" subtitle="Photo and video coverage per vehicle, tracked against the listing checklist." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2">
          {readiness.length === 0 ? (
            <EmptyState title="No active vehicles" />
          ) : (
            readiness.map(({ episode: e, media }) => (
              <Link
                key={e.id}
                href={`/media?episode=${e.id}`}
                className={`block rounded-lg border bg-white p-3 shadow-sm hover:border-brand-600 ${selected?.id === e.id ? "border-brand-600" : "border-stone-200"}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-stone-900">{e.stockNumber}</p>
                  <Badge tone={media.complete ? "green" : "amber"}>
                    {media.requiredSatisfied}/{media.requiredTotal}
                  </Badge>
                </div>
                <p className="text-xs text-stone-500">{vehicleLabel(e.vehicle)}</p>
              </Link>
            ))
          )}
        </div>

        <div className="lg:col-span-2">
          {!selected ? (
            <EmptyState title="Select a vehicle" hint="Choose a vehicle to see its checklist and assets." />
          ) : (
            <div className="space-y-6">
              <Card>
                <h2 className="mb-3 text-base font-semibold text-stone-900">
                  {selected.stockNumber} — checklist
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(await mediaReadiness(selected.id)).items.map((i) => (
                    <li key={i.key} className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 text-sm">
                      <span className="text-stone-800">
                        {i.name}
                        {i.required ? <span className="text-red-600"> *</span> : null}
                      </span>
                      <Badge tone={i.satisfied ? "green" : "neutral"}>{i.count}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>

              {canUpload ? (
                <Card>
                  <h2 className="mb-3 text-sm font-semibold text-stone-900">Upload</h2>
                  <form action="/api/media/upload" method="post" encType="multipart/form-data" className="grid gap-2 sm:grid-cols-4">
                    <input type="hidden" name="episodeId" value={selected.id} />
                    <input type="hidden" name="redirectTo" value={`/media?episode=${selected.id}`} />
                    <div className="sm:col-span-2">
                      <label htmlFor="m-file" className="block text-xs font-medium text-stone-500">File</label>
                      <input id="m-file" name="file" type="file" required accept="image/*,video/mp4,video/quicktime,application/pdf" className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="m-cat" className="block text-xs font-medium text-stone-500">Category</label>
                      <select id="m-cat" name="category" className={inputClass}>
                        {checklist.map((c) => (
                          <option key={c.key} value={c.key}>{c.name}</option>
                        ))}
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="m-kind" className="block text-xs font-medium text-stone-500">Kind</label>
                      <select id="m-kind" name="kind" className={inputClass}>
                        <option value="PHOTO">Photo</option>
                        <option value="VIDEO">Video</option>
                        <option value="DOCUMENT">Document</option>
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                        Upload
                      </button>
                    </div>
                  </form>
                </Card>
              ) : null}

              <Card>
                <h2 className="mb-3 text-sm font-semibold text-stone-900">Assets</h2>
                {selectedAssets.length === 0 ? (
                  <p className="text-sm text-stone-500">No media yet.</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-3">
                    {selectedAssets.map((a) => (
                      <li key={a.id} className="overflow-hidden rounded-md border border-stone-200">
                        {a.kind === "PHOTO" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/files/${a.fileId}`} alt={a.caption ?? a.category} className="h-32 w-full object-cover" />
                        ) : (
                          <div className="flex h-32 items-center justify-center bg-stone-100 text-xs text-stone-500">
                            {a.kind.toLowerCase()}
                          </div>
                        )}
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <span className="text-xs text-stone-600">{a.category.replace(/_/g, " ")}</span>
                          {canEdit ? (
                            <form action={archiveMediaAssetAction}>
                              <input type="hidden" name="assetId" value={a.id} />
                              <button type="submit" className="text-xs text-stone-400 hover:text-red-700">archive</button>
                            </form>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
