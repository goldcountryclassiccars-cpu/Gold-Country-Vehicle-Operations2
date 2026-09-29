import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/authz/engine";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { storage } from "@/lib/adapters/storage";
import { FILLED_COPY_MARK } from "@/modules/esign/service";

const metaSchema = z.object({
  requirementId: z.string().uuid(),
  saleId: z.string().uuid(),
});

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Staff finished a produced document's remaining blanks (fees, trade-in,
 * payment method) in Preview or Acrobat and upload the completed PDF. It
 * becomes the next version of that checklist row's document — the one
 * "Open document" shows and "Send for signature" sends.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasPermission(user, "documents", "edit")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const form = await req.formData();
  const parsed = metaSchema.safeParse({ requirementId: form.get("requirementId"), saleId: form.get("saleId") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
  const { saleId, requirementId } = parsed.data;
  const back = (err?: string) =>
    NextResponse.redirect(new URL(`/sales/${saleId}${err ? `?docError=${err}` : ""}#sale-docs`, req.url), 303);

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back("nofile");
  if (file.size > MAX_BYTES) return back("toolarge");
  const data = Buffer.from(await file.arrayBuffer());
  // Judge by the bytes, not the browser's label — Safari sometimes sends none.
  if (data.subarray(0, 5).toString() !== "%PDF-") return back("notpdf");

  const row = await db.saleDocumentRequirement.findUnique({ where: { id: requirementId }, include: { template: true } });
  if (!row || row.saleId !== saleId) return NextResponse.json({ error: "No such requirement" }, { status: 404 });
  if (row.template.category !== 1) return back("notours");

  const prior = row.documentInstanceId ? await db.documentInstance.findUnique({ where: { id: row.documentInstanceId } }) : null;
  if (prior && (prior.status === "SENT" || prior.status === "PARTIALLY_SIGNED")) return back("outforsignature");

  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  const latest = await db.documentInstance.findFirst({ where: { saleId, templateId: row.templateId }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const storageKey = `documents/${sale.episodeId}/${row.template.key}${FILLED_COPY_MARK}v${version}.pdf`;
  await storage().put(storageKey, data);
  const stored = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: file.name,
      contentType: "application/pdf",
      sizeBytes: data.length,
      uploadedBy: user.id,
      sensitivity: "signed_docs", // a completed form carries the buyer's details
    },
  });
  const instance = await db.documentInstance.create({
    data: { episodeId: sale.episodeId, saleId, templateId: row.templateId, version, fileId: stored.id, generatedById: user.id },
  });
  if (prior && prior.status === "GENERATED") {
    await db.documentInstance.update({ where: { id: prior.id }, data: { status: "VOIDED" } });
  }
  await db.saleDocumentRequirement.update({
    where: { id: row.id },
    data: { documentInstanceId: instance.id, prefillAvailable: true, readyForSignature: true },
  });
  await audit(user, {
    action: "document.filled_copy",
    resourceType: "document",
    resourceId: instance.id,
    newValues: { template: row.template.key, version, saleId, replaced: prior?.id ?? null },
  });
  return back();
}
