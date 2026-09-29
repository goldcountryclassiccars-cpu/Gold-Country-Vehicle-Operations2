import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { verifyBoldSignSignature } from "@/lib/adapters/signing";
import { EsignError, handleProviderEvent } from "@/modules/esign/service";

export const runtime = "nodejs";

/**
 * BoldSign webhook: https://<app>/api/esign/boldsign
 *
 * The body is only trusted after its HMAC checks out, and even then only its
 * document id is used — the status is read back from BoldSign itself. Replies
 * 200 to anything verified (including BoldSign's test "Verify" event) so the
 * provider doesn't retry forever; a 401 for anything unsigned.
 */
export async function POST(req: NextRequest) {
  const secret = config().BOLDSIGN_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifyBoldSignSignature(raw, req.headers.get("x-boldsign-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let documentId: string | null = null;
  try {
    const body = JSON.parse(raw) as { data?: { documentId?: unknown; object?: unknown } };
    if (body.data?.object === "document" && typeof body.data.documentId === "string") documentId = body.data.documentId;
  } catch {
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  try {
    const result = await handleProviderEvent(documentId);
    return NextResponse.json({ ok: true, handled: result.handled });
  } catch (e) {
    // The envelope keeps its lastError for staff to see; tell BoldSign to retry.
    if (e instanceof EsignError) return NextResponse.json({ error: "Sync failed, will retry" }, { status: 502 });
    throw e;
  }
}
