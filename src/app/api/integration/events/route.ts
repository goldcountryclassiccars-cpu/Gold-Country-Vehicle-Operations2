import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { integrationAuthorized } from "@/lib/integration-auth";

/**
 * Listing-application pull endpoint: pending outbox events, oldest first.
 * Auth: Authorization: Bearer <LISTING_API_KEY>.
 */
export async function GET(req: NextRequest) {
  if (!integrationAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status") ?? "PENDING";
  const events = await db.integrationEvent.findMany({
    where: status === "ALL" ? {} : { status: status as never },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      episodeId: e.episodeId,
      payload: e.payload,
      idempotencyKey: e.idempotencyKey,
      status: e.status,
      createdAt: e.createdAt,
    })),
  });
}
