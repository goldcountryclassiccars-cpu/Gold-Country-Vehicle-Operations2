"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  markLiveAction,
  publishListingAction,
  unpublishListingAction,
  type ListingFormState,
} from "@/modules/listings/actions";
import { Badge } from "@/components/ui";

interface Pub {
  channelKey: string;
  channelName: string;
  method: "FEED" | "MANUAL";
  enabled: boolean;
  status: "QUEUED" | "LIVE" | "REMOVING" | "OFF";
  behind: boolean;
  needsTakedown: boolean;
  externalUrl: string | null;
  liveAt: string | null;
  lastDeliveredAt: string | null;
}

function statusBadge(p: Pub) {
  if (p.needsTakedown) return <Badge tone="red">sold — take down</Badge>;
  if (p.status === "LIVE" && p.behind) return <Badge tone="amber">live · update waiting</Badge>;
  if (p.status === "LIVE") return <Badge tone="green">live</Badge>;
  if (p.status === "QUEUED") return <Badge tone="blue">{p.method === "FEED" ? "queued" : "to post"}</Badge>;
  if (p.status === "REMOVING") return <Badge tone="amber">coming down</Badge>;
  return <Badge tone="neutral">not listed</Badge>;
}

function explain(p: Pub): string {
  if (!p.enabled) return "Switched off in channel settings.";
  if (p.needsTakedown) return `The car is sold — remove the listing on ${p.channelName}, then press Take down.`;
  if (p.method === "FEED") {
    if (p.status === "QUEUED") return `Waiting for ${p.channelName} to pick up the feed.`;
    if (p.status === "LIVE" && p.behind) return `Your latest changes go out at ${p.channelName}'s next pickup.`;
    if (p.status === "REMOVING") return `Comes off at ${p.channelName}'s next pickup.`;
    if (p.status === "LIVE") return p.lastDeliveredAt ? `Up to date — last picked up ${new Date(p.lastDeliveredAt).toLocaleString()}.` : "Up to date.";
    return "Sent automatically by feed once published.";
  }
  if (p.status === "QUEUED") return `Post it on ${p.channelName} from the posting kit, then mark it live.`;
  if (p.status === "LIVE" && p.behind) return `You've changed the listing since it was posted — update it on ${p.channelName}, then mark live again.`;
  if (p.status === "LIVE") return p.liveAt ? `Posted ${new Date(p.liveAt).toLocaleDateString()}.` : "Posted.";
  return "Posted by hand from the posting kit (no feed set up yet).";
}

export function PublishPanel({
  episodeId,
  hasListing,
  canPublish,
  ready,
  availability,
  publications,
}: {
  episodeId: string;
  hasListing: boolean;
  canPublish: boolean;
  ready: boolean;
  availability: "available" | "pending" | "sold";
  publications: Pub[];
}) {
  const [pubState, pubAction, pubPending] = useActionState<ListingFormState, FormData>(publishListingAction, {});
  const [offState, offAction] = useActionState<ListingFormState, FormData>(unpublishListingAction, {});
  const [liveState, liveAction, livePending] = useActionState<ListingFormState, FormData>(markLiveAction, {});
  const error = pubState.error ?? offState.error ?? liveState.error;
  const notice = pubState.notice ?? offState.notice ?? liveState.notice;

  // Live channels update themselves (feed) or by "Mark live" (by hand); the
  // publish box is only for places the listing is not on.
  const publishable = publications.filter((p) => p.enabled && (p.status === "OFF" || p.status === "REMOVING"));

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : notice ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">✓ {notice}</p>
      ) : null}

      <ul className="divide-y divide-stone-100">
        {publications.map((p) => (
          <li key={p.channelKey} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-stone-900">{p.channelName}</span>
              {statusBadge(p)}
            </div>
            <p className="mt-0.5 text-xs text-stone-500">
              {explain(p)}
              {p.method === "FEED" ? <span className="ml-1 text-stone-400">· automatic</span> : <span className="ml-1 text-stone-400">· by hand</span>}
            </p>
            {p.externalUrl ? (
              <a href={p.externalUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">
                View on {p.channelName} ↗
              </a>
            ) : null}

            {canPublish && hasListing ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {p.method === "MANUAL" && (p.status === "QUEUED" || (p.status === "LIVE" && p.behind)) ? (
                  <>
                    <Link
                      href={`/listings/${episodeId}/kit?channel=${p.channelKey}`}
                      className="min-h-9 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-stone-50"
                    >
                      Posting kit
                    </Link>
                    <form action={liveAction} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="channel" value={p.channelKey} />
                      <label htmlFor={`url-${p.channelKey}`} className="sr-only">
                        Link to the live listing on {p.channelName}
                      </label>
                      <input
                        id={`url-${p.channelKey}`}
                        name="url"
                        defaultValue={p.externalUrl ?? ""}
                        placeholder={`Link on ${p.channelName} (optional)`}
                        className="min-h-9 w-48 rounded-md border border-stone-300 px-2 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={livePending}
                        className="min-h-9 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                      >
                        Mark live
                      </button>
                    </form>
                  </>
                ) : null}
                {p.status !== "OFF" && p.status !== "REMOVING" ? (
                  <form
                    action={offAction}
                    onSubmit={(e) => {
                      if (!window.confirm(`Take this listing down from ${p.channelName}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="episodeId" value={episodeId} />
                    <input type="hidden" name="channel" value={p.channelKey} />
                    <button type="submit" className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-xs text-stone-700 hover:border-red-300 hover:text-red-700">
                      Take down
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canPublish && hasListing && publishable.length > 0 ? (
        <form action={pubAction} className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-3">
          <input type="hidden" name="episodeId" value={episodeId} />
          <p className="text-sm font-medium text-stone-800">Publish to</p>
          {availability === "sold" ? (
            <p className="text-xs text-amber-800">This car is sold — only our website shows sold cars; the marketplaces will not carry it.</p>
          ) : null}
          {publishable.map((p) => (
            <label key={p.channelKey} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="channel"
                value={p.channelKey}
                defaultChecked={availability !== "sold" || p.channelKey === "website"}
              />
              {p.channelName}
            </label>
          ))}
          <button
            type="submit"
            disabled={pubPending || !ready}
            className="min-h-11 w-full rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {pubPending ? "Publishing…" : "Publish"}
          </button>
          {!ready ? <p className="text-xs text-stone-500">Finish the required items above first.</p> : null}
        </form>
      ) : null}

      {!hasListing ? <p className="text-sm text-stone-500">Start the listing to publish it.</p> : null}
    </div>
  );
}
