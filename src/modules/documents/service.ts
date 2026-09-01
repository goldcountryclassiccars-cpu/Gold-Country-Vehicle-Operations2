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

/** Generates (or re-generates as a new version) a document for a sale. */
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

  const pdfData = await renderDemoPdf({
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
  const storageKey = `documents/${sale.episodeId}/${template.key}-v${version}.pdf`;
  await storage().put(storageKey, pdfData);
  const file = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: `${template.key}-v${version}.pdf`,
      contentType: "application/pdf",
      sizeBytes: pdfData.length,
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
    newValues: { template: template.key, version, saleId },
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
