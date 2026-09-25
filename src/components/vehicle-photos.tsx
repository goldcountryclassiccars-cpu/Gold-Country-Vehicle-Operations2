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
import { inputClass } from "@/components/ui";

const WEB_MAX = 1600; // px, longest edge of the gallery copy
const THUMB_MAX = 400;

interface FileStatus {
  name: string;
  progress: number; // 0..100
  state: "preparing" | "uploading" | "saving" | "done" | "failed";
  error?: string;
}

async function resizeTo(bitmap: ImageBitmap, maxEdge: number): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

/** Web + thumb copies; null when the browser can't decode this image format. */
async function makeVariants(file: File): Promise<{ web: Blob | null; thumb: Blob | null }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const [web, thumb] = await Promise.all([resizeTo(bitmap, WEB_MAX), resizeTo(bitmap, THUMB_MAX)]);
    bitmap.close();
    return { web, thumb };
  } catch {
    return { web: null, thumb: null };
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

export function PhotoUploader({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (idx: number, patch: Partial<FileStatus>) =>
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  async function handleFiles(list: FileList) {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setBusy(true);
    setFiles(picked.map((f) => ({ name: f.name, progress: 0, state: "preparing" as const })));

    for (let i = 0; i < picked.length; i++) {
      const file = picked[i]!;
      try {
        const contentType = file.type || "image/jpeg";
        const variants = await makeVariants(file);

        const requested = await requestPhotoUploadAction({
          episodeId,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
        });
        if (requested.error || !requested.targets) {
          update(i, { state: "failed", error: requested.error ?? "Could not start the upload." });
          continue;
        }
        const target = (v: string) => requested.targets!.find((t) => t.variant === v)!;

        // Weight progress by bytes across the copies being sent.
        const jobs: { t: { putUrl: string | null; fallbackUrl: string }; data: Blob; type: string }[] = [
          { t: target("original"), data: file, type: contentType },
        ];
        if (variants.web) jobs.push({ t: target("web"), data: variants.web, type: "image/jpeg" });
        if (variants.thumb) jobs.push({ t: target("thumb"), data: variants.thumb, type: "image/jpeg" });
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
        const finalized = await finalizePhotoUploadAction({
          episodeId,
          originalName: file.name,
          contentType,
          originalKey: target("original").key,
          webKey: variants.web ? target("web").key : null,
          thumbKey: variants.thumb ? target("thumb").key : null,
        });
        if (finalized.error) {
          update(i, { state: "failed", error: finalized.error });
          continue;
        }
        update(i, { state: "done" });
        router.refresh();
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
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    // Clear the finished rows a beat later so "done" is visible but does not pile up.
    setTimeout(() => setFiles((prev) => prev.filter((f) => f.state !== "done")), 2500);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="min-h-11 w-full rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Uploading…" : "Add photos"}
      </button>
      {files.length > 0 ? (
        <ul className="space-y-1">
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
                <p className="mt-0.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-red-900">{f.error}</p>
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
