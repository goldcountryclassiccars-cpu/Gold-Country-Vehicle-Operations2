import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, hasPermission } from "@/lib/authz/engine";
import type { SensitiveField } from "@/lib/authz/registry";
import { db } from "@/lib/db";
import { storage } from "@/lib/adapters/storage";

/**
 * Authorized file download. Files are private by default; sensitive files
 * additionally require the matching field grant. Storage keys are never
 * exposed — only opaque FileObject ids.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const file = await db.fileObject.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Media files require media:view; other files default to documents:view.
  const asset = await db.mediaAsset.findFirst({ where: { fileId: id } });
  if (asset) {
    if (!hasPermission(user, "media", "view")) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  } else if (!hasPermission(user, "documents", "view") && !user.isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (file.sensitivity && !canViewField(user, file.sensitivity as SensitiveField)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const data = await storage().get(file.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${file.originalName.replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File data unavailable" }, { status: 404 });
  }
}
