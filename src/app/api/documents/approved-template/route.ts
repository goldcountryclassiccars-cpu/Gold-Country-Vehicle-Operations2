import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/authz/engine";
import { uploadApprovedTemplate, TemplateError } from "@/modules/documents/templates";

const metaSchema = z.object({
  templateKey: z.string().min(1),
  versionNote: z.string().optional(),
  redirectTo: z.string().optional(),
});

/**
 * Multipart upload for a counsel-approved document template.
 *
 * A route rather than a server action because a server action cannot take a
 * file upload from a plain HTML form, and this page has to work on the shop
 * iPad without client-side JavaScript like everything else in the app.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasPermission(user, "admin", "manage_config")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const parsed = metaSchema.safeParse({
    templateKey: form.get("templateKey"),
    versionNote: form.get("versionNote") ?? undefined,
    redirectTo: form.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });

  const back = parsed.data.redirectTo?.startsWith("/") ? parsed.data.redirectTo : "/admin/documents";

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(new URL(`${back}?error=nofile`, req.url), 303);
  }

  try {
    await uploadApprovedTemplate(user, {
      templateKey: parsed.data.templateKey,
      originalName: file.name,
      contentType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
      versionNote: parsed.data.versionNote ?? null,
    });
  } catch (e) {
    // Errors come back on the page rather than as JSON — nobody uploading a
    // purchase agreement on an iPad should land on a raw error document.
    const message = e instanceof TemplateError ? e.message : "Upload failed";
    return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent(message)}`, req.url), 303);
  }

  return NextResponse.redirect(new URL(`${back}?loaded=${encodeURIComponent(parsed.data.templateKey)}`, req.url), 303);
}
