import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { integrationAuthorized } from "@/lib/integration-auth";
import { listingReadiness, mediaReadiness } from "@/modules/media/service";

/**
 * Authoritative vehicle/episode data for the listing application.
 * Public-listing fields ONLY — no confidential economics, no PII.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!integrationAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const episode = await db.inventoryEpisode.findUnique({
    where: { id },
    include: { vehicle: { include: { identifiers: { where: { isPrimary: true } } } } },
  });
  if (!episode) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [media, readiness, assets] = await Promise.all([
    mediaReadiness(id),
    listingReadiness(id),
    db.mediaAsset.findMany({ where: { episodeId: id, archivedAt: null }, orderBy: { sortOrder: "asc" } }),
  ]);
  const v = episode.vehicle;
  return NextResponse.json({
    episodeId: episode.id,
    vehicleId: episode.vehicleId,
    stockNumber: episode.stockNumber,
    dealType: episode.dealType,
    availability: {
      salesStatus: episode.salesStatus,
      marketingStatus: episode.marketingStatus,
      active: episode.active,
    },
    askingPrice: episode.askingPrice ? Number(episode.askingPrice) : null,
    vehicle: {
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      bodyStyle: v.bodyStyle,
      exteriorColor: v.exteriorColor,
      interiorColor: v.interiorColor,
      engineDescription: v.engineDescription,
      transmission: v.transmission,
      drivetrain: v.drivetrain,
      mileage: v.mileage,
      mileageStatus: v.mileageStatus,
      matchingNumbers: v.matchingNumbers,
      generalDescription: v.generalDescription,
      primaryIdentifier: v.identifiers[0]?.value ?? null,
    },
    media: {
      readiness: media,
      assets: assets.map((a) => ({ id: a.id, kind: a.kind, category: a.category, caption: a.caption, fileId: a.fileId })),
    },
    listingReadiness: readiness,
  });
}
