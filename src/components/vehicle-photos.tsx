"use client";

/**
 * Photo uploader + video-link form for a vehicle.
 *
 * Photos are resized in the browser (web copy + thumbnail) and PUT directly to
 * storage, so a 12MB phone photo never has to squeeze through the app server.
 * Every failure is shown next to the file it belongs to — nothing fails
 * silently (the v18/v19 lesson).
 */

import { useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  addVideoLinkAction,
  finalizePhotoUploadAction,
  requestPhotoUploadAction,
  type MediaFormState,
} from "@/modules/media/actions";
import {
  finalizeListingPhotoUploadAction,
  refreshListingAction,
  requestListingPhotoUploadAction,
} from "@/modules/listings/actions";
import { inputClass } from "@/components/ui";

const WEB_MAX = 1600; // px, longest edge of the gallery copy
const THUMB_MAX = 400;
const LARGE_MAX = 2400; // px, the copy listing platforms receive
/** Listing batches upload a few at a time; intake stays one by one (shop Wi-Fi). */
const LISTING_CONCURRENCY = 3;

interface FileStatus {
  name: string;
  progress: number; // 0..100
  state: "preparing" | "uploading" | "saving" | "done" | "failed";
  error?: string;
}

async function resizeTo(bitmap: ImageBitmap, maxEdge: number, quality = 0.82): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Web + thumb (+ large for listings) copies; null when the browser can't decode this image format. */
async function makeVariants(
  file: File,
  withLarge: boolean,
): Promise<{ web: Blob | null; thumb: Blob | null; large: Blob | null }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const [web, thumb, large] = await Promise.all([
      resizeTo(bitmap, WEB_MAX),
      resizeTo(bitmap, THUMB_MAX),
      withLarge ? resizeTo(bitmap, LARGE_MAX, 0.88) : Promise.resolve(null),
    ]);
    bitmap.close();
    return { web, thumb, large };
  } catch {
    return { web: null, thumb: null, large: null };
  }
}

function putWithProgress(url: string, data: Blob, contentType: string, onProgress: (frac: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("network"));
    xhr.send(data);
  });
}

/** Direct to storage first; the app's own route as fallback. */
async function uploadVariant(
  target: { putUrl: string | null; fallbackUrl: string },
  data: Blob,
  contentType: string,
  onProgress: (frac: number) => void,
) {
  if (target.putUrl) {
    try {
      await putWithProgress(target.putUrl, data, contentType, onProgress);
      return;
    } catch {
      // fall through — storage may be unreachable from this network (or CORS);
      // small files can still go through the app.
    }
  }
  await putWithProgress(target.fallbackUrl, data, contentType, onProgress);
}

export function PhotoUploader({
  episodeId,
  purpose = "INTAKE",
  remaining,
  buttonLabel = "Add photos",
}: {
  episodeId: string;
  purpose?: "INTAKE" | "LISTING";
  /** Slots left before the listing's photo limit; extra picks are refused up front. */
  remaining?: number;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listing = purpose === "LISTING";

  const update = (idx: number, patch: Partial<FileStatus>) =>
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  async function uploadOne(file: File, i: number) {
    try {
      const contentType = file.type || "image/jpeg";
      const variants = await makeVariants(file, listing);

      const req = { episodeId, fileName: file.name, contentType, sizeBytes: file.size };
      const requested = listing ? await requestListingPhotoUploadAction(req) : await requestPhotoUploadAction(req);
      if (requested.error || !requested.targets) {
        update(i, { state: "failed", error: requested.error ?? "Could not start the upload." });
        return;
      }
      const target = (v: string) => requested.targets!.find((t) => t.variant === v)!;

      // Weight progress by bytes across the copies being sent.
      const jobs: { t: { putUrl: string | null; fallbackUrl: string }; data: Blob; type: string }[] = [
        { t: target("original"), data: file, type: contentType },
      ];
      if (variants.web) jobs.push({ t: target("web"), data: variants.web, type: "image/jpeg" });
      if (variants.thumb) jobs.push({ t: target("thumb"), data: variants.thumb, type: "image/jpeg" });
      if (listing && variants.large) jobs.push({ t: target("large"), data: variants.large, type: "image/jpeg" });
      const totalBytes = jobs.reduce((s, j) => s + j.data.size, 0);
      let doneBytes = 0;

      update(i, { state: "uploading" });
      for (const job of jobs) {
        await uploadVariant(job.t, job.data, job.type, (frac) => {
          update(i, { progress: Math.round(((doneBytes + frac * job.data.size) / totalBytes) * 100) });
        });
        doneBytes += job.data.size;
      }

      update(i, { state: "saving", progress: 100 });
      const fin = {
        episodeId,
        originalName: file.name,
        contentType,
        originalKey: target("original").key,
        webKey: variants.web ? target("web").key : null,
        thumbKey: variants.thumb ? target("thumb").key : null,
      };
      const finalized = listing
        ? await finalizeListingPhotoUploadAction({ ...fin, largeKey: variants.large ? target("large").key : null })
        : await finalizePhotoUploadAction(fin);
      if (finalized.error) {
        update(i, { state: "failed", error: finalized.error });
        return;
      }
      update(i, {
        state: "done",
        error:
          listing && !variants.large
            ? "Saved, but this browser could not convert it (HEIC?) — platforms may not accept it. Upload from the iPhone or re-export as JPEG."
            : undefined,
      });
      // Intake keeps its one-at-a-time refresh; a listing batch refreshes once at the end.
      if (!listing) router.refresh();
    } catch (e) {
      update(i, {
        state: "failed",
        error:
          e instanceof Error && e.message === "network"
            ? "The upload could not reach storage — check the connection and try again."
            : "Upload failed — please try again.",
      });
    }
  }

  async function handleFiles(list: FileList) {
    let picked = Array.from(list);
    if (picked.length === 0) return;
    setNotice(null);
    if (remaining !== undefined) {
      if (remaining <= 0) {
        setNotice("This listing already has 100 photos — remove some before adding more.");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      if (picked.length > remaining) {
        setNotice(
          `You picked ${picked.length} photos but only ${remaining} more fit (100 per listing). The first ${remaining} are uploading; the rest were left out.`,
        );
        picked = picked.slice(0, remaining);
      }
    }
    setBusy(true);
    setFiles(picked.map((f) => ({ name: f.name, progress: 0, state: "preparing" as const })));

    const concurrency = listing ? LISTING_CONCURRENCY : 1;
    let next = 0;
    const worker = async () => {
      while (next < picked.length) {
        const i = next++;
        await uploadOne(picked[i]!, i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, picked.length) }, worker));

    if (listing) await refreshListingAction(episodeId);
    router.refresh();
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    // Clear the finished rows a beat later so "done" is visible but does not pile up.
    setTimeout(() => setFiles((prev) => prev.filter((f) => f.state !== "done" || f.error)), 2500);
  }

  const doneCount = files.filter((f) => f.state === "done").length;
  const failedCount = files.filter((f) => f.state === "failed").length;

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid={listing ? "listing-photo-input" : "intake-photo-input"}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy || (remaining !== undefined && remaining <= 0)}
        onClick={() => inputRef.current?.click()}
        className="min-h-11 w-full rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60 sm:w-auto"
      >
        {busy ? `Uploading… ${doneCount}/${files.length}` : buttonLabel}
      </button>
      {notice ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>
      ) : null}
      {busy && files.length > 3 ? (
        <p className="text-xs text-stone-600">
          {doneCount} of {files.length} done{failedCount ? ` · ${failedCount} failed` : ""} — keep this page open until it finishes.
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {files.map((f, i) => (
            <li key={i} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-stone-700">{f.name}</span>
                <span className={f.state === "failed" ? "text-red-700" : "text-stone-500"}>
                  {f.state === "preparing" && "preparing…"}
                  {f.state === "uploading" && `${f.progress}%`}
                  {f.state === "saving" && "saving…"}
                  {f.state === "done" && "✓ done"}
                  {f.state === "failed" && "failed"}
                </span>
              </div>
              {f.state === "uploading" ? (
                <div className="mt-0.5 h-1 overflow-hidden rounded bg-stone-200">
                  <div className="h-full bg-brand-600" style={{ width: `${f.progress}%` }} />
                </div>
              ) : null}
              {f.error ? (
                <p
                  className={
                    f.state === "done"
                      ? "mt-0.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
                      : "mt-0.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-red-900"
                  }
                >
                  {f.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AddVideoLinkForm({ episodeId }: { episodeId: string }) {
  const [state, formAction, pending] = useActionState<MediaFormState, FormData>(addVideoLinkAction, {});
  return (
    <form key={state.saved ?? 0} action={formAction} className="space-y-2">
      {state.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p>
      ) : null}
      <input type="hidden" name="episodeId" value={episodeId} />
      <label htmlFor="vl-url" className="block text-xs font-medium text-stone-600">Video link</label>
      <input
        id="vl-url"
        name="url"
        placeholder="https:// — Google Photos or YouTube link"
        className={inputClass + " mt-0"}
      />
      <label htmlFor="vl-label" className="block text-xs font-medium text-stone-600">Label (optional)</label>
      <input id="vl-label" name="label" placeholder="e.g. Walkaround, Cold start" className={inputClass + " mt-0"} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add video link"}
      </button>
    </form>
  );
}
