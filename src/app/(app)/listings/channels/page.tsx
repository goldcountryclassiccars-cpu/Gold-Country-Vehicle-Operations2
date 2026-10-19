import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { ensureChannels, feedUrls } from "@/modules/listings/service";
import { updateChannelAction } from "@/modules/listings/actions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CopyBlock } from "../[id]/kit/kit-tools";

export const metadata: Metadata = { title: "Listing channels" };

const SETUP: Record<string, string> = {
  website:
    "Our WordPress site imports this feed on a schedule (every 15–30 minutes) and creates or updates each Vehicle page from it. Sold cars stay in this feed marked “sold”, so their pages can stay live. Switch to Automatic once the site is reading it.",
  hemmings:
    "Ask our Hemmings rep to set up a dealer inventory feed from this link (CSV or XML — whichever their import team prefers). Until they confirm it is running, leave this on “By hand”: publish puts the car on your to-post list and the posting kit has the text and photos.",
  classiccars:
    "Ask ClassicCars.com dealer support to import our inventory from this link (CSV or XML). Until it is running, leave this on “By hand” and post from the posting kit.",
  classic_com:
    "classic.com takes dealer inventory as a data feed — send their dealer team this link (CSV or XML). Until they confirm, post by hand from the posting kit.",
  autotrader_classics:
    "Ask our AutotraderClassics.com rep whether they can import this feed link directly; otherwise it is posted by hand from the posting kit.",
  craigslist:
    "Posted by hand: Craigslist has no dealer feed. The posting kit downloads the first 24 photos (Craigslist's limit) and gives plain-text copy. Craigslist ads expire — re-post and mark live again when they do.",
  facebook_marketplace:
    "Posted by hand from the Dealer Page or a personal profile; the kit downloads the first 20 photos. (A dealer catalog feed exists through Meta's approved vehicle partners — ask us to look into it once volume justifies it.)",
  facebook_page:
    "A post on our Facebook Dealer Page. Use the short post from the posting kit; mark live once it's up so the app reminds you to post “SOLD” when it sells.",
  facebook_groups:
    "Posts in classic-car buy/sell groups. Use the short post and photos from the posting kit; paste the post link when marking live so it can be found again to mark sold.",
};

export default async function ListingChannelsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "manage_config", "listings");
  const channels = await ensureChannels();
  const counts = await db.listingPublication.groupBy({ by: ["channelKey", "status"], _count: true });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Listing channels"
        subtitle="Where listings are published, and how each place receives them."
        actions={
          <Link href="/listings" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
            ← Listings
          </Link>
        }
      />
      <div className="space-y-6">
        {channels.map((c) => {
          const urls = feedUrls(c);
          const live = counts.find((x) => x.channelKey === c.key && x.status === "LIVE")?._count ?? 0;
          const queued = counts.find((x) => x.channelKey === c.key && x.status === "QUEUED")?._count ?? 0;
          return (
            <Card key={c.key} accent={c.enabled ? (c.method === "FEED" ? "green" : "amber") : "stone"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-stone-900">{c.name}</h2>
                <div className="flex items-center gap-2">
                  <Badge tone={c.enabled ? "green" : "neutral"}>{c.enabled ? "on" : "off"}</Badge>
                  <Badge tone={c.method === "FEED" ? "blue" : "amber"}>{c.method === "FEED" ? "automatic (feed)" : "by hand"}</Badge>
                </div>
              </div>
              <p className="mt-1 text-sm text-stone-600">{SETUP[c.key]}</p>
              <p className="mt-2 text-xs text-stone-500">
                {live} live · {queued} waiting ·{" "}
                {c.lastFetchAt
                  ? `feed last picked up ${c.lastFetchAt.toLocaleString()}${c.lastFetchFrom ? ` by ${c.lastFetchFrom.slice(0, 60)}` : ""}`
                  : "feed never picked up"}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={updateChannelAction}>
                  <input type="hidden" name="key" value={c.key} />
                  <input type="hidden" name="method" value={c.method === "FEED" ? "MANUAL" : "FEED"} />
                  <button type="submit" className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50">
                    {c.method === "FEED" ? "Switch to by hand" : "Switch to automatic (feed is set up)"}
                  </button>
                </form>
                <form action={updateChannelAction}>
                  <input type="hidden" name="key" value={c.key} />
                  <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
                  <button type="submit" className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50">
                    {c.enabled ? "Turn off" : "Turn on"}
                  </button>
                </form>
              </div>

              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-700">Feed links to give {c.name}</summary>
                <div className="mt-3 space-y-3">
                  <CopyBlock label="CSV (one row per car, photo links separated by |)" text={urls.csv} rows={2} />
                  <CopyBlock label="XML" text={urls.xml} rows={2} />
                  <CopyBlock label="JSON (our website)" text={urls.json} rows={2} />
                  <p className="text-xs text-stone-500">
                    Add <code className="rounded bg-stone-100 px-1">&amp;preview=1</code> to look at a feed yourself without it
                    counting as a pickup. The key in these links is private: if one is ever shared by mistake, change it — the
                    old links stop working and you send the new ones.
                  </p>
                  <form action={updateChannelAction}>
                    <input type="hidden" name="key" value={c.key} />
                    <input type="hidden" name="rotate" value="1" />
                    <button type="submit" className="min-h-10 rounded-md border border-red-200 bg-white px-3 text-sm text-red-700 hover:bg-red-50">
                      Change the feed key
                    </button>
                  </form>
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
