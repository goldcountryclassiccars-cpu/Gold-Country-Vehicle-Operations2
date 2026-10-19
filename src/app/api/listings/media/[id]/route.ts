import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RELAY_MAX_BYTES, storage } from "@/lib/adapters/storage";

export const dynamic = "force-dynamic";

/**
 * Public listing photos and videos — the URLs in the feeds, which our website
 * and the marketplaces download. Serves ONLY listing media (never intake
 * photos), only while the listing is published somewhere, and only by
 * unguessable asset id. Photos come as the 2400px JPEG made for platforms,
 * falling back to the gallery copy, then the original.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.purpose !== "LISTING" || asset.archivedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const published = await db.listingPublication.count({
    where: { status: { in: ["QUEUED", "LIVE", "REMOVING"] }, listing: { episodeId: asset.episodeId } },
  });
  if (published === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thumb = req.nextUrl.searchParams.get("size") === "thumb";
  const fileId =
    asset.kind === "VIDEO"
      ? asset.fileId
      : thumb
        ? (asset.thumbFileId ?? asset.webFileId ?? asset.fileId)
        : (asset.largeFileId ?? asset.webFileId ?? asset.fileId);
  const file = await db.fileObject.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (asset.kind === "VIDEO" || file.sizeBytes > RELAY_MAX_BYTES) {
    const direct = await storage().presignGet(file.storageKey, { contentType: file.contentType, expiresIn: 6 * 60 * 60 });
    if (direct) return NextResponse.redirect(direct, 302);
  }
  try {
    const data = await storage().get(file.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "File data unavailable" }, { status: 404 });
  }
}
