"use client";

import { useState } from "react";

export function CopyBlock({ label, text, rows = 3 }: { label: string; text: string; rows?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-stone-800">{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              window.prompt("Copy this text:", text);
            }
          }}
          className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-xs font-medium hover:bg-stone-50"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <textarea readOnly value={text} rows={rows} className="w-full rounded-md border border-stone-200 bg-stone-50 p-2 font-mono text-xs text-stone-800" />
    </div>
  );
}

/**
 * Downloads every listing photo, in order and numbered (01-cover.jpg, 02.jpg …),
 * as one ZIP built in the browser — what you drag into a platform's uploader.
 */
export function DownloadPhotos({ photos, fileBase }: { photos: { url: string }[]; fileBase: string }) {
  const [state, setState] = useState<{ done: number; error?: string } | null>(null);
  async function run() {
    setState({ done: 0 });
    try {
      const { zip } = await import("fflate");
      const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
      let done = 0;
      // Four at a time — quick, without flooding a phone connection.
      let next = 0;
      const worker = async () => {
        while (next < photos.length) {
          const i = next++;
          const res = await fetch(photos[i]!.url, { credentials: "same-origin" });
          if (!res.ok) throw new Error(`Photo ${i + 1} could not be downloaded (${res.status}).`);
          const type = res.headers.get("content-type") ?? "image/jpeg";
          const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("heic") ? "heic" : "jpg";
          const name = `${String(i + 1).padStart(2, "0")}${i === 0 ? "-cover" : ""}.${ext}`;
          entries[name] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
          done += 1;
          setState({ done });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker));
      const data = await new Promise<Uint8Array>((resolve, reject) => zip(entries, (err, out) => (err ? reject(err) : resolve(out))));
      const blob = new Blob([data as BlobPart], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileBase}-photos.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setState(null);
    } catch (e) {
      setState({ done: 0, error: e instanceof Error ? e.message : "Download failed — try again." });
    }
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={photos.length === 0 || (state != null && !state.error)}
        onClick={run}
        className="min-h-11 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {state && !state.error ? `Preparing… ${state.done}/${photos.length}` : `Download all ${photos.length} photos (ZIP)`}
      </button>
      {state?.error ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p> : null}
    </div>
  );
}
