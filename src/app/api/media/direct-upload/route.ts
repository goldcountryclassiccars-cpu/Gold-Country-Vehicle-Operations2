import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { storage, verifyUploadToken } from "@/lib/adapters/storage";

/**
 * Token-authorized upload route. This is the upload path in local development
 * (where there is no object store to presign against) and the small-file
 * fallback in production when a browser's direct PUT to storage fails.
 * The token — signed server-side when the upload was requested — pins the
 * exact storage key, content type, uploader and size cap, so this route never
 * trusts anything the client chose on its own.
 *
 * Note: on Vercel this route inherits the platform's ~4.5MB request cap, which
 * is why big originals go directly to storage instead.
 */
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const payload = verifyUploadToken(token);
  if (!payload) return NextResponse.json({ error: "Upload link is invalid or expired" }, { status: 403 });
  if (payload.userId !== user.id) {
    return NextResponse.json({ error: "Upload link belongs to a different sign-in" }, { status: 403 });
  }

  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0) return NextResponse.json({ error: "Empty upload" }, { status: 400 });
  if (data.length > payload.maxBytes) {
    return NextResponse.json({ error: "File is larger than the upload allows" }, { status: 413 });
  }

  await storage().put(payload.key, data);
  return NextResponse.json({ ok: true, sizeBytes: data.length });
}
