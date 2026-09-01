import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/authz/engine";
import { uploadMediaAsset } from "@/modules/media/service";

const metaSchema = z.object({
  episodeId: z.string().uuid(),
  kind: z.enum(["PHOTO", "VIDEO", "DOCUMENT"]).default("PHOTO"),
  category: z.string().min(1).default("other"),
  caption: z.string().optional(),
});

/** Multipart upload endpoint for vehicle media. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasPermission(user, "media", "create")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  const parsed = metaSchema.safeParse({
    episodeId: form.get("episodeId"),
    kind: form.get("kind") ?? undefined,
    category: form.get("category") ?? undefined,
    caption: form.get("caption") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });

  try {
    const asset = await uploadMediaAsset(user, {
      ...parsed.data,
      originalName: file.name,
      contentType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });
    const redirectTo = form.get("redirectTo");
    if (typeof redirectTo === "string" && redirectTo.startsWith("/")) {
      return NextResponse.redirect(new URL(redirectTo, req.url), 303);
    }
    return NextResponse.json({ id: asset.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
