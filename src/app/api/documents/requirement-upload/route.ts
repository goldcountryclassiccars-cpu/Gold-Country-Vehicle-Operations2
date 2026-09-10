import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/authz/engine";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { storage } from "@/lib/adapters/storage";
import { attachRequirementFile } from "@/modules/documents/requirements";

const metaSchema = z.object({
  requirementId: z.string().uuid(),
  saleId: z.string().uuid(),
});

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Attaches a document that someone else produced — a smog certificate, an
 * NMVTIS report, a lien release, a copy of the buyer's ID.
 *
 * These arrive as a PDF or, far more often, a photo taken on a phone at the
 * counter, so the accepted types are deliberately wide. Stored with
 * `signed_docs` sensitivity, so the existing field grants decide who can open
 * it afterwards.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasPermission(user, "documents", "edit")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const form = await req.formData();
  const parsed = metaSchema.safeParse({
    requirementId: form.get("requirementId"),
    saleId: form.get("saleId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
  const back = `/sales/${parsed.data.saleId}#sale-docs`;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(new URL(`${back}`, req.url), 303);
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.redirect(new URL(`/sales/${parsed.data.saleId}?docError=toolarge`, req.url), 303);
  }

  const requirement = await db.saleDocumentRequirement.findUnique({
    where: { id: parsed.data.requirementId },
    include: { template: true },
  });
  if (!requirement || requirement.saleId !== parsed.data.saleId) {
    return NextResponse.json({ error: "No such requirement" }, { status: 404 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `collected/${parsed.data.saleId}/${requirement.template.key}-${Date.now()}-${safeName}`;
  await storage().put(storageKey, data);

  const stored = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: data.length,
      uploadedBy: user.id,
      sensitivity: "signed_docs",
    },
  });

  await attachRequirementFile(user, requirement.id, stored.id);
  return NextResponse.redirect(new URL(back, req.url), 303);
}
