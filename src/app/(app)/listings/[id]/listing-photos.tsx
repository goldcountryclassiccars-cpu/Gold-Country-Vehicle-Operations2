"use client";

/**
 * The listing's photo set, in buyer order. Arranging works two ways:
 * - tap a photo, then use the bar under the grid (works on a phone and the iPad);
 * - drag and drop (computer).
 * Every change saves straight away; a refused save puts the old order back and
 * says why.
 */
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  copyIntakePhotosAction,
  removeListingMediaAction,
  reorderListingPhotosAction,
  type ListingFormState,
} from "@/modules/listings/actions";

interface Photo {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  caption: string | null;
  platformReady: boolean;
}

export function ListingPhotoGrid({ episodeId, canEdit, photos }: { episodeId: string; canEdit: boolean; photos: Photo[] }) {
  const router = useRouter();
  const [order, setOrder] = useState<Photo[]>(photos);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const dragId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // New uploads arrive through the server; take them unless we're mid-save.
  useEffect(() => {
    setOrder(photos);
  }, [photos]);

  const save = (next: Photo[], previous: Photo[]) => {
    setOrder(next);
    setError(null);
    startSaving(async () => {
      const res = await reorderListingPhotosAction({ episodeId, orderedIds: next.map((p) => p.id) });
      if (res.error) {
        setOrder(previous);
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  };

  const move = (id: string, to: number) => {
    const from = order.findIndex((p) => p.id === id);
    if (from < 0) return;
    const clamped = Math.max(0, Math.min(order.length - 1, to));
    if (clamped === from) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(clamped, 0, item!);
    save(next, order);
  };

  const remove = (id: string) => {
    if (!window.confirm("Remove this photo from the listing? (Intake photos are not affected.)")) return;
    const previous = order;
    setOrder(order.filter((p) => p.id !== id));
    setSelected(null);
    startSaving(async () => {
      const res = await removeListingMediaAction({ episodeId, assetId: id });
      if (res.error) {
        setOrder(previous);
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  };

  if (order.length === 0) {
    return <p className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">No listing photos yet.</p>;
  }

  const selIndex = selected ? order.findIndex((p) => p.id === selected) : -1;
  const sel = selIndex >= 0 ? order[selIndex] : null;

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5" aria-label="Listing photos in order">
        {order.map((p, i) => (
          <li
            key={p.id}
            draggable={canEdit}
            onDragStart={() => {
              dragId.current = p.id;
            }}
            onDragOver={(e) => {
              if (!canEdit || !dragId.current) return;
              e.preventDefault();
              setDragOver(p.id);
            }}
            onDragLeave={() => setDragOver((d) => (d === p.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (dragId.current && dragId.current !== p.id) move(dragId.current, i);
              dragId.current = null;
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDragOver(null);
            }}
            className={`relative overflow-hidden rounded-md border-2 ${
              selected === p.id ? "border-brand-600" : dragOver === p.id ? "border-amber-500" : "border-transparent"
            }`}
          >
            <button
              type="button"
              onClick={() => (canEdit ? setSelected(selected === p.id ? null : p.id) : window.open(p.fullUrl, "_blank"))}
              className="block w-full"
              aria-label={`Photo ${i + 1}${i === 0 ? " (cover)" : ""}${canEdit ? " — tap to arrange" : ""}`}
              aria-pressed={canEdit ? selected === p.id : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt={p.caption ?? `Listing photo ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full bg-stone-100 object-cover" />
            </button>
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {i === 0 ? "Cover" : i + 1}
            </span>
            {!p.platformReady ? (
              <span
                className="pointer-events-none absolute bottom-1 left-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                title="This browser could not convert the photo; platforms may not accept the original."
              >
                HEIC
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {canEdit && sel ? (
        <div className="sticky bottom-2 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-2 shadow-sm">
          <span className="px-1 text-sm font-medium text-brand-900">
            Photo {selIndex + 1}
            {selIndex === 0 ? " (cover)" : ""}
          </span>
          <button
            type="button"
            disabled={selIndex === 0 || saving}
            onClick={() => move(sel.id, 0)}
            className="min-h-10 rounded-md bg-brand-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Make cover
          </button>
          <button
            type="button"
            disabled={selIndex === 0 || saving}
            onClick={() => move(sel.id, selIndex - 1)}
            className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm disabled:opacity-50"
            aria-label="Move earlier"
          >
            ◀ Earlier
          </button>
          <button
            type="button"
            disabled={selIndex === order.length - 1 || saving}
            onClick={() => move(sel.id, selIndex + 1)}
            className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm disabled:opacity-50"
            aria-label="Move later"
          >
            Later ▶
          </button>
          <label className="flex items-center gap-1 text-sm text-stone-700">
            Move to #
            <input
              type="number"
              min={1}
              max={order.length}
              key={sel.id + selIndex}
              defaultValue={selIndex + 1}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  move(sel.id, Number((e.target as HTMLInputElement).value) - 1);
                }
              }}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n - 1 !== selIndex) move(sel.id, n - 1);
              }}
              className="w-16 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <a href={sel.fullUrl} target="_blank" rel="noreferrer" className="min-h-10 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">
            Open
          </a>
          <button
            type="button"
            disabled={saving}
            onClick={() => remove(sel.id)}
            className="min-h-10 rounded-md border border-red-300 bg-white px-3 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
          <button type="button" onClick={() => setSelected(null)} className="ml-auto min-h-10 px-2 text-sm text-stone-500">
            Done
          </button>
        </div>
      ) : null}
      {saving ? <p className="mt-2 text-xs text-stone-500">Saving order…</p> : null}
    </div>
  );
}

export function CopyIntakePhotos({
  episodeId,
  photos,
}: {
  episodeId: string;
  photos: { id: string; thumbUrl: string; caption: string | null }[];
}) {
  const [state, formAction, pending] = useActionState<ListingFormState, FormData>(copyIntakePhotosAction, {});
  return (
    <details className="rounded-md border border-stone-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-brand-700">Use some Intake Photos here ({photos.length})</summary>
      <p className="mt-2 text-xs text-stone-500">
        Tick any intake shots good enough for buyers. They are added to the end of the listing; the intake record is not
        changed.
      </p>
      <form key={state.saved ?? 0} action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="episodeId" value={episodeId} />
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((p) => (
            <li key={p.id}>
              <label className="block cursor-pointer overflow-hidden rounded-md border border-stone-200 has-[:checked]:border-brand-600 has-[:checked]:ring-2 has-[:checked]:ring-brand-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt={p.caption ?? "Intake photo"} loading="lazy" className="aspect-square w-full object-cover" />
                <span className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-stone-600">
                  <input type="checkbox" name="assetId" value={p.id} /> Use
                </span>
              </label>
            </li>
          ))}
        </ul>
        {state.error ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p> : null}
        {state.notice ? <p className="text-sm text-emerald-700">✓ {state.notice}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add ticked photos to the listing"}
        </button>
      </form>
    </details>
  );
}
