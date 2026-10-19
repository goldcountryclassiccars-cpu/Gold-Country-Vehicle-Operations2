import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { renderCsv, renderJson, renderXml } from "@/modules/listings/feed";
import { CHANNEL_KEYS, dealerInfo, ensureChannels, feedForChannel, recordFeedPickup } from "@/modules/listings/service";

export const dynamic = "force-dynamic";

function tokenMatches(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Inventory feed for one channel — what our website or a marketplace's
 * dealer-feed importer fetches on its schedule.
 *
 *   GET /api/listings/feed/<channel>?token=<feed token>&format=json|xml|csv
 *
 * Public listing fields only (no cost, no consignor, no customer data). A
 * fetch from a FEED channel is recorded as a pickup: queued listings become
 * live, and listings no longer carried (taken down, sold off a marketplace)
 * are marked off. Add `&preview=1` to look without recording a pickup.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel: key } = await params;
  if (!CHANNEL_KEYS.includes(key)) return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  await ensureChannels();
  const channel = await db.listingChannel.findUnique({ where: { key } });
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!channel || !token || !tokenMatches(token, channel.feedToken)) {
    return NextResponse.json({ error: "Feed link is missing its key or the key has been changed" }, { status: 401 });
  }
  if (!channel.enabled) return NextResponse.json({ error: `${channel.name} is switched off` }, { status: 403 });

  const format = (req.nextUrl.searchParams.get("format") ?? "json").toLowerCase();
  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const delivered = await feedForChannel(key);
  const now = new Date();

  if (channel.method === "FEED" && !preview) {
    const from = req.headers.get("user-agent");
    await recordFeedPickup(key, delivered, from);
  }

  const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
  if (format === "xml") {
    return new NextResponse(renderXml(delivered.listings, dealerInfo(), now), {
      headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" },
    });
  }
  if (format === "csv") {
    return new NextResponse(renderCsv(delivered.listings, dealerInfo()), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `inline; filename="gccc-inventory-${key}.csv"`,
      },
    });
  }
  return NextResponse.json(renderJson(delivered.listings, dealerInfo(), now), { headers });
}
