/**
 * Phase 6 documents: demonstration PDF generation (pdf-lib), versioning,
 * mock e-signature flow. Every generated document is watermarked
 * "DEMONSTRATION — NOT AN APPROVED LEGAL DOCUMENT" until the dealership's
 * approved templates are configured (see SALES_DOCUMENT_SETUP.md).
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { storage } from "@/lib/adapters/storage";
import { config } from "@/lib/config";
import { esign } from "@/lib/adapters/esign";
import type { SessionUser } from "@/lib/authz/types";
import { vehicleLabel } from "@/modules/vehicles/service";

export class DocumentError extends Error {}

async function renderDemoPdf(input: {
  templateName: string;
  stockNumber: string;
  vehicle: string;
  buyerName?: string;
  agreedPrice?: number | null;
  dealType: string;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Watermark
  page.drawText("DEMONSTRATION — NOT AN APPROVED LEGAL DOCUMENT", {
    x: 40,
    y: 380,
    size: 22,
    font: bold,
    color: rgb(0.85, 0.2, 0.2),
    rotate: degrees(30),
    opacity: 0.35,
  });

  page.drawText("Gold Country Classic Cars — Vehicle Operations", { x: 50, y: 740, size: 10, font, color: rgb(0.4, 0.35, 0.25) });
  page.drawText(input.templateName, { x: 50, y: 705, size: 20, font: bold, color: rgb(0.11, 0.11, 0.1) });

  const lines = [
    `Stock number: ${input.stockNumber}`,
    `Vehicle: ${input.vehicle}`,
    `Deal type: ${input.dealType === "CONSIGNMENT" ? "Consignment" : "Dealer-owned"}`,
    input.buyerName ? `Buyer: ${input.buyerName}` : null,
    input.agreedPrice != null ? `Agreed price: $${input.agreedPrice.toLocaleString()}` : null,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "This demonstration document shows the generation, versioning, signature",
    "and filing workflow. Replace with the dealership's legally reviewed",
    "template before any real use (see SALES_DOCUMENT_SETUP.md).",
  ].filter((l): l is string => l !== null);

  let y = 660;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.15, 0.15, 0.14) });
    y -= 22;
  }
  page.drawText("Signature: ____________________________    Date: ____________", { x: 50, y: 120, size: 12, font });

  return Buffer.from(await pdf.save());
}

/**
 * Generates (or re-generates as a new version) a document for a sale.
 *
 * If the dealership has loaded its own approved file for this template, that
 * file is what the buyer gets — no watermark, no text drafted by this app. The
 * approved blank is copied per sale rather than shared, so a later phase can
 * fill it in without touching the master.
 *
 * With no approved file it falls back to the DEMONSTRATION stand-in, which
 * exists to exercise the workflow and is labelled as such on its face.
 */
export async function generateDocument(user: SessionUser, saleId: string, templateId: string) {
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  const [template, episode, buyer] = await Promise.all([
    db.documentTemplate.findUniqueOrThrow({ where: { id: templateId } }),
    db.inventoryEpisode.findUniqueOrThrow({ where: { id: sale.episodeId }, include: { vehicle: true } }),
    db.party.findUniqueOrThrow({ where: { id: sale.buyerPartyId } }),
  ]);
  if (template.appliesTo !== "all" && template.appliesTo !== episode.dealType) {
    throw new DocumentError("Template does not apply to this deal type");
  }

  const approved = template.approvedFileId
    ? await db.fileObject.findUnique({ where: { id: template.approvedFileId } })
    : null;

  const data: Buffer = approved
    ? await storage().get(approved.storageKey)
    : await renderDemoPdf({
        templateName: template.name,
        stockNumber: episode.stockNumber,
        vehicle: vehicleLabel(episode.vehicle),
        buyerName: buyer.displayName,
        agreedPrice: Number(sale.agreedPrice),
        dealType: episode.dealType,
      });

  const prior = await db.documentInstance.findFirst({
    where: { saleId, templateId },
    orderBy: { version: "desc" },
  });
  const version = (prior?.version ?? 0) + 1;
  const extension = approved ? (approved.contentType === "application/pdf" ? "pdf" : "docx") : "pdf";
  const storageKey = `documents/${sale.episodeId}/${template.key}-v${version}.${extension}`;
  await storage().put(storageKey, data);
  const file = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: `${template.key}-v${version}.${extension}`,
      contentType: approved?.contentType ?? "application/pdf",
      sizeBytes: data.length,
      uploadedBy: user.id,
      sensitivity: "signed_docs",
    },
  });
  const instance = await db.documentInstance.create({
    data: {
      episodeId: sale.episodeId,
      saleId,
      templateId,
      version,
      fileId: file.id,
      generatedById: user.id,
    },
  });
  if (prior && prior.status === "GENERATED") {
    await db.documentInstance.update({ where: { id: prior.id }, data: { status: "VOIDED" } });
  }
  await audit(user, {
    action: "document.generate",
    resourceType: "document",
    resourceId: instance.id,
    newValues: { template: template.key, version, saleId, approved: Boolean(approved) },
  });

  // Point the compliance checklist row at what was just produced, so the row
  // can open it. Without this the document exists but the checklist has no way
  // to reach it, which is what made the documents feel inaccessible.
  await db.saleDocumentRequirement.updateMany({
    where: { saleId, templateId },
    data: { documentInstanceId: instance.id, prefillAvailable: true, readyForSignature: true },
  });

  return instance;
}

/** Sends a document through the (mock) e-signature adapter. */
export async function sendDocument(user: SessionUser, documentId: string) {
  const doc = await db.documentInstance.findUniqueOrThrow({ where: { id: documentId }, include: { template: true, sale: true } });
  if (doc.status !== "GENERATED") throw new DocumentError("Only freshly generated documents can be sent");
  const buyer = doc.sale ? await db.party.findUniqueOrThrow({ where: { id: doc.sale.buyerPartyId } }) : null;
  const { envelopeExternalId } = await esign().createEnvelope({
    documentIds: [doc.id],
    recipients: buyer?.email ? [{ name: buyer.displayName, email: buyer.email, signingOrder: 1 }] : [],
    subject: `${doc.template.name} — signature requested`,
  });
  await esign().send(envelopeExternalId);
  const updated = await db.documentInstance.update({
    where: { id: documentId },
    data: { status: "SENT", envelopeExternalId, sentAt: new Date() },
  });
  await audit(user, { action: "document.send", resourceType: "document", resourceId: documentId });
  return updated;
}

/** Development helper: simulate the envelope completing (mock adapter only). */
export async function markDocumentSigned(user: SessionUser, documentId: string) {
  const doc = await db.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
  if (doc.status !== "SENT" && doc.status !== "PARTIALLY_SIGNED") {
    throw new DocumentError("Document is not out for signature");
  }
  const updated = await db.documentInstance.update({
    where: { id: documentId },
    data: { status: "SIGNED", signedAt: new Date() },
  });
  await audit(user, { action: "document.signed", resourceType: "document", resourceId: documentId });
  return updated;
}

export async function fileDocument(user: SessionUser, documentId: string) {
  const doc = await db.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
  if (doc.status !== "SIGNED") throw new DocumentError("Only signed documents can be filed");
  const updated = await db.documentInstance.update({
    where: { id: documentId },
    data: { status: "FILED", filedAt: new Date() },
  });
  await audit(user, { action: "document.file", resourceType: "document", resourceId: documentId });
  return updated;
}

/**
 * Produces an intake-timed document (the consignment agreement above all) for
 * a car that has no sale yet. Serves the dealership's approved copy when one
 * is loaded; otherwise the DEMONSTRATION stand-in, labelled as such. The
 * instance hangs on the episode (saleId null) — if a deal opens later, the
 * sale checklist adopts what was filed here rather than asking again.
 */
export async function produceIntakeDocument(user: SessionUser, episodeId: string, templateKey: string) {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { vehicle: true },
  });
  const template = await db.documentTemplate.findUniqueOrThrow({ where: { key: templateKey } });
  if (!template.active) throw new DocumentError("This document is no longer active.");
  if (template.timing !== "INTAKE") {
    throw new DocumentError("Only intake-timed documents can be produced without a sale.");
  }
  // Category 3 is a controlled original (a title, a serialized DMV form) and
  // category 4 is produced by a third party — neither has a blank we print.
  if (template.category !== 1 && template.category !== 2) {
    throw new DocumentError("This document is issued elsewhere — it cannot be printed from here.");
  }
  if (template.appliesTo !== "all" && template.appliesTo !== episode.dealType) {
    throw new DocumentError("Template does not apply to this deal type");
  }

  const approved = template.approvedFileId
    ? await db.fileObject.findUnique({ where: { id: template.approvedFileId } })
    : null;
  const data: Buffer = approved
    ? await storage().get(approved.storageKey)
    : await renderDemoPdf({
        templateName: template.name,
        stockNumber: episode.stockNumber,
        vehicle: vehicleLabel(episode.vehicle),
        dealType: episode.dealType,
      });

  const prior = await db.documentInstance.findFirst({
    where: { episodeId, saleId: null, templateId: template.id },
    orderBy: { version: "desc" },
  });
  const version = (prior?.version ?? 0) + 1;
  const extension = approved ? (approved.contentType === "application/pdf" ? "pdf" : "docx") : "pdf";
  const storageKey = `documents/${episodeId}/intake-${template.key}-v${version}.${extension}`;
  await storage().put(storageKey, data);
  const file = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: `${episode.stockNumber}-${template.key}-v${version}.${extension}`,
      contentType: approved?.contentType ?? "application/pdf",
      sizeBytes: data.length,
      uploadedBy: user.id,
      // A blank copy for this car holds no customer data yet. The SIGNED scan
      // uploaded later is what carries signed_docs sensitivity.
      sensitivity: null,
    },
  });
  const instance = await db.documentInstance.create({
    data: { episodeId, saleId: null, templateId: template.id, version, fileId: file.id, generatedById: user.id },
  });
  if (prior && prior.status === "GENERATED") {
    await db.documentInstance.update({ where: { id: prior.id }, data: { status: "VOIDED" } });
  }
  await audit(user, {
    action: "document.generate",
    resourceType: "document",
    resourceId: instance.id,
    newValues: { template: template.key, version, episodeId, approved: Boolean(approved), intake: true },
  });
  return { instance, fileId: file.id, approved: Boolean(approved) };
}

const ALLOWED_SCAN_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_SCAN_BYTES = 25 * 1024 * 1024;

/**
 * Records that the signed intake document is on file — with a scan or photo of
 * the signed copy when there is one, or by marking the produced copy filed.
 * FILED always points at evidence: with no scan there must be a produced copy
 * to mark, so "on file" can never be claimed about nothing.
 */
export async function markIntakeDocumentOnFile(
  user: SessionUser,
  episodeId: string,
  templateKey: string,
  scan?: { originalName: string; contentType: string; data: Buffer } | null,
) {
  const template = await db.documentTemplate.findUniqueOrThrow({ where: { key: templateKey } });
  const prior = await db.documentInstance.findFirst({
    where: { episodeId, saleId: null, templateId: template.id, status: { not: "VOIDED" } },
    orderBy: { version: "desc" },
  });

  if (scan) {
    if (!ALLOWED_SCAN_TYPES.has(scan.contentType)) {
      throw new DocumentError("Upload the signed copy as a PDF or a photo (JPEG/PNG/HEIC).");
    }
    if (scan.data.length === 0) throw new DocumentError("That file is empty.");
    if (scan.data.length > MAX_SCAN_BYTES) throw new DocumentError("That file is larger than 25MB.");

    const version = (prior?.version ?? 0) + 1;
    const ext = scan.contentType === "application/pdf" ? "pdf" : (scan.contentType.split("/")[1] ?? "bin");
    const storageKey = `documents/${episodeId}/intake-${template.key}-signed-v${version}.${ext}`;
    await storage().put(storageKey, scan.data);
    const file = await db.fileObject.create({
      data: {
        storageKey,
        adapter: config().STORAGE_ADAPTER,
        originalName: scan.originalName,
        contentType: scan.contentType,
        sizeBytes: scan.data.length,
        uploadedBy: user.id,
        sensitivity: "signed_docs", // the signed copy carries the consignor's details
      },
    });
    const instance = await db.documentInstance.create({
      data: {
        episodeId,
        saleId: null,
        templateId: template.id,
        version,
        fileId: file.id,
        generatedById: user.id,
        status: "FILED",
        signedAt: new Date(),
        filedAt: new Date(),
      },
    });
    await audit(user, {
      action: "document.filed",
      resourceType: "document",
      resourceId: instance.id,
      newValues: { template: template.key, episodeId, scanned: true },
    });
    return instance;
  }

  if (!prior) {
    throw new DocumentError("Nothing to mark on file — print the document first, or upload the signed copy.");
  }
  const instance = await db.documentInstance.update({
    where: { id: prior.id },
    data: { status: "FILED", signedAt: prior.signedAt ?? new Date(), filedAt: new Date() },
  });
  await audit(user, {
    action: "document.filed",
    resourceType: "document",
    resourceId: instance.id,
    newValues: { template: template.key, episodeId, scanned: false },
  });
  return instance;
}
