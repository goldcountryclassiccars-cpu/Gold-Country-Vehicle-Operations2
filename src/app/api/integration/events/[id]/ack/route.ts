import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { integrationAuthorized } from "@/lib/integration-auth";

/** Acknowledge delivery of one outbox event. Idempotent. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!integrationAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const event = await db.integrationEvent.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.status !== "DELIVERED") {
    await db.integrationEvent.update({
      where: { id },
      data: { status: "DELIVERED", deliveredAt: new Date(), attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
  }
  return NextResponse.json({ ok: true });
}
