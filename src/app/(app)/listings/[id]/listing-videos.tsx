"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addListingVideoLinkAction,
  finalizeListingVideoUploadAction,
  removeListingMediaAction,
  removeListingVideoLinkAction,
  requestListingVideoUploadAction,
  type ListingFormState,
} from "@/modules/listings/actions";
import { inputClass } from "@/components/ui";

function put(url: string, file: File, onProgress: (f: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

export function ListingVideos({
  episodeId,
  canAdd,
  canEdit,
  files,
  links,
}: {
  episodeId: string;
  canAdd: boolean;
  canEdit: boolean;
  files: { id: string; url: string; caption: string | null }[];
  links: { id: string; url: string; label: string | null }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number; error?: string } | null>(null);
  const [, startTransition] = useTransition();
  const [linkState, linkAction, linkPending] = useActionState<ListingFormState, FormData>(addListingVideoLinkAction, {});

  async function handle(file: File) {
    setUpload({ name: file.name, progress: 0 });
    const contentType = file.type || (file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
    const req = await requestListingVideoUploadAction({ episodeId, fileName: file.name, contentType, sizeBytes: file.size });
    if (req.error || !req.key) {
      setUpload({ name: file.name, progress: 0, error: req.error ?? "Could not start the upload." });
      return;
    }
    try {
      const onProgress = (f: number) => setUpload({ name: file.name, progress: Math.round(f * 100) });
      if (req.putUrl) {
        try {
          await put(req.putUrl, file, onProgress);
        } catch {
          await put(req.fallbackUrl!, file, onProgress);
        }
      } else {
        await put(req.fallbackUrl!, file, onProgress);
      }
    } catch {
      setUpload({
        name: file.name,
        progress: 0,
        error: "The video could not reach storage. Check the connection — or upload it to YouTube and add the link below.",
      });
      return;
    }
    const fin = await finalizeListingVideoUploadAction({ episodeId, originalName: file.name, contentType, key: req.key });
    if (fin.error) {
      setUpload({ name: file.name, progress: 100, error: fin.error });
      return;
    }
    setUpload(null);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  const removeFile = (id: string) => {
    if (!window.confirm("Remove this video from the listing?")) return;
    startTransition(async () => {
      const res = await removeListingMediaAction({ episodeId, assetId: id });
      if (res.error) setUpload({ name: "", progress: 0, error: res.error });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {files.length === 0 && links.length === 0 ? <p className="text-sm text-stone-500">No listing videos yet.</p> : null}

      {files.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {files.map((f) => (
            <li key={f.id} className="rounded-md border border-stone-200 p-2">
              <video src={f.url} controls preload="metadata" className="aspect-video w-full rounded bg-black" />
              <div className="mt-1 flex items-center justify-between text-xs text-stone-600">
                <span>{f.caption || "Uploaded video"}</span>
                {canEdit ? (
                  <button type="button" onClick={() => removeFile(f.id)} className="text-stone-400 hover:text-red-700">
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {links.length > 0 ? (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <a href={l.url} target="_blank" rel="noreferrer" className="truncate font-medium text-brand-700 hover:underline">
                {l.label || new URL(l.url).host}
              </a>
              {canEdit ? (
                <form action={removeListingVideoLinkAction}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="episodeId" value={episodeId} />
                  <button type="submit" className="text-xs text-stone-400 hover:text-red-700">
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canAdd ? (
        <div className="grid gap-4 border-t border-stone-200 pt-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-stone-800">Upload a video file</p>
            <p className="mb-2 text-xs text-stone-500">MP4 or MOV from a phone, up to 500MB.</p>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mov,.mp4"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])}
            />
            <button
              type="button"
              disabled={Boolean(upload && !upload.error)}
              onClick={() => inputRef.current?.click()}
              className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-60"
            >
              {upload && !upload.error ? `Uploading… ${upload.progress}%` : "Upload video"}
            </button>
            {upload && !upload.error ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-stone-200">
                <div className="h-full bg-brand-600" style={{ width: `${upload.progress}%` }} />
              </div>
            ) : null}
            {upload?.error ? (
              <p role="alert" className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                {upload.error}
              </p>
            ) : null}
          </div>

          <form key={linkState.saved ?? 0} action={linkAction} className="space-y-2">
            <input type="hidden" name="episodeId" value={episodeId} />
            <p className="text-sm font-medium text-stone-800">Add a YouTube or video link</p>
            {linkState.error ? (
              <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                {linkState.error}
              </p>
            ) : null}
            <label htmlFor="lv-url" className="sr-only">
              Video link
            </label>
            <input id="lv-url" name="url" placeholder="https://youtu.be/…" className={inputClass + " mt-0"} />
            <label htmlFor="lv-label" className="sr-only">
              Label
            </label>
            <input id="lv-label" name="label" placeholder="Label, e.g. Walkaround" className={inputClass + " mt-0"} />
            <button
              type="submit"
              disabled={linkPending}
              className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-60"
            >
              {linkPending ? "Adding…" : "Add link"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
